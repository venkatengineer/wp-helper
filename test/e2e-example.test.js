import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runTests } from '../src/test-runner.js';
import { runRepairLoop } from '../src/repair-loop.js';
import { MockProvider } from '../src/providers/mock.js';
import { BackupManager } from '../src/backup-manager.js';
import { Logger, LogLevel } from '../src/logger.js';

describe('End-to-End Fixture Project: Missing Function Repair', () => {
  const silentLogger = new Logger({ level: LogLevel.QUIET, silent: true });
  const fixtureDir = path.resolve('examples/missing-function-project');

  it('runs baseline failure, generates missing function via repair loop, verifies passing tests, and tests rollback', async () => {
    // 1. Copy fixture to temporary test directory
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-fixture-'));
    try {
      fs.cpSync(fixtureDir, tmpDir, { recursive: true });

      // 2. Verify baseline test fails
      const baseline = await runTests(tmpDir, {
        testFiles: ['test/calculator.test.js'],
        customTestCommand: 'node --test test/calculator.test.js'
      });

      assert.equal(baseline.passed, false, 'Baseline test must fail due to missing add() function');
      assert.ok(
        baseline.rawOutput.includes('add') || baseline.rawOutput.includes('TypeError') || baseline.assertionErrors.length > 0,
        'Baseline failure should mention missing add function'
      );

      // 3. Mock AI provider providing the missing add function while preserving existing subtract
      const mockProvider = new MockProvider({
        responses: [
          {
            summary: 'Implement missing add function in src/calculator.js',
            edits: [
              {
                path: 'src/calculator.js',
                operation: 'replace',
                content: `export function subtract(a, b) {\n  return a - b;\n}\n\nexport function add(a, b) {\n  return a + b;\n}\n`,
                reason: 'Implements add function required by test/calculator.test.js'
              }
            ],
            questions: []
          }
        ]
      });

      // 4. Run autonomous repair loop
      const repairResult = await runRepairLoop(tmpDir, {
        logger: silentLogger,
        provider: mockProvider,
        applyDirectly: true,
        allowDirty: true,
        testFilter: 'test/calculator.test.js',
        config: { customTestCommand: 'node --test test/calculator.test.js' }
      });

      assert.equal(repairResult.status, 'success');
      assert.equal(repairResult.passed, true);
      assert.equal(repairResult.attempts, 1);
      assert.ok(repairResult.modifiedFiles.includes('src/calculator.js'));
      assert.ok(repairResult.backupId);

      // Verify file content on disk now has add()
      const repairedContent = fs.readFileSync(path.join(tmpDir, 'src/calculator.js'), 'utf8');
      assert.ok(repairedContent.includes('export function add(a, b)'));
      assert.ok(repairedContent.includes('export function subtract(a, b)'));

      // Verify independent verification with test runner passes
      const verifyRun = await runTests(tmpDir, {
        testFiles: ['test/calculator.test.js'],
        customTestCommand: 'node --test test/calculator.test.js'
      });
      assert.equal(verifyRun.passed, true);

      // 5. Test rollback restores original state
      const backupManager = new BackupManager(tmpDir);
      const rollbackResult = backupManager.rollback(repairResult.backupId);
      assert.equal(rollbackResult.success, true);

      // Verify file is back to missing add()
      const restoredContent = fs.readFileSync(path.join(tmpDir, 'src/calculator.js'), 'utf8');
      assert.equal(restoredContent.includes('export function add'), false);

      // Verify tests fail again after rollback
      const postRollbackRun = await runTests(tmpDir, {
        testFiles: ['test/calculator.test.js'],
        customTestCommand: 'node --test test/calculator.test.js'
      });
      assert.equal(postRollbackRun.passed, false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
