import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runRepairLoop } from '../src/repair-loop.js';
import { MockProvider } from '../src/providers/mock.js';
import { Logger, LogLevel } from '../src/logger.js';

describe('Autonomous Repair Loop', () => {
  const silentLogger = new Logger({ level: LogLevel.QUIET, silent: true });

  it('exits early with already_passing when baseline tests succeed', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rep-pass-'));
    try {
      fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ type: 'module' }));
      fs.mkdirSync(path.join(tmpDir, 'test'), { recursive: true });
      fs.writeFileSync(
        path.join(tmpDir, 'test/sample.test.js'),
        "import test from 'node:test'; import assert from 'node:assert'; test('passes', () => assert.equal(1, 1));\n"
      );

      const result = await runRepairLoop(tmpDir, {
        logger: silentLogger,
        config: { customTestCommand: 'node --test test/sample.test.js' }
      });

      assert.equal(result.status, 'already_passing');
      assert.equal(result.passed, true);
      assert.equal(result.attempts, 0);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('successfully repairs failing test using mock AI provider on first attempt', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rep-fix-'));
    try {
      fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ type: 'module' }));
      fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
      fs.mkdirSync(path.join(tmpDir, 'test'), { recursive: true });

      // Failing implementation
      fs.writeFileSync(path.join(tmpDir, 'src/calc.js'), 'export const add = () => 0;\n');
      // Test expecting add(2, 3) === 5
      fs.writeFileSync(
        path.join(tmpDir, 'test/calc.test.js'),
        "import test from 'node:test'; import assert from 'node:assert'; import { add } from '../src/calc.js'; test('adds', () => assert.equal(add(2, 3), 5));\n"
      );

      const mockProvider = new MockProvider({
        responses: [
          {
            summary: 'Fix addition calculation',
            edits: [
              {
                path: 'src/calc.js',
                operation: 'replace',
                content: 'export const add = (a, b) => a + b;\n',
                reason: 'Implements addition correctly'
              }
            ],
            questions: []
          }
        ]
      });

      const result = await runRepairLoop(tmpDir, {
        logger: silentLogger,
        provider: mockProvider,
        applyDirectly: true,
        allowDirty: true,
        config: { customTestCommand: 'node --test test/calc.test.js' }
      });

      assert.equal(result.status, 'success');
      assert.equal(result.passed, true);
      assert.equal(result.attempts, 1);
      assert.ok(result.modifiedFiles.includes('src/calc.js'));
      assert.ok(result.backupId);

      // Verify repaired file on disk
      const repaired = fs.readFileSync(path.join(tmpDir, 'src/calc.js'), 'utf8');
      assert.ok(repaired.includes('a + b'));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('respects retry limits when tests continue failing', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rep-limit-'));
    try {
      fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ type: 'module' }));
      fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
      fs.mkdirSync(path.join(tmpDir, 'test'), { recursive: true });

      fs.writeFileSync(path.join(tmpDir, 'src/calc.js'), 'export const add = () => 0;\n');
      fs.writeFileSync(
        path.join(tmpDir, 'test/calc.test.js'),
        "import test from 'node:test'; import assert from 'node:assert'; import { add } from '../src/calc.js'; test('adds', () => assert.equal(add(2, 3), 5));\n"
      );

      // Provider that continually provides incomplete fix
      const mockProvider = new MockProvider({
        responses: [
          {
            summary: 'Attempt 1',
            edits: [{ path: 'src/calc.js', operation: 'replace', content: 'export const add = () => 1;\n', reason: 'Attempt 1' }]
          },
          {
            summary: 'Attempt 2',
            edits: [{ path: 'src/calc.js', operation: 'replace', content: 'export const add = () => 2;\n', reason: 'Attempt 2' }]
          }
        ]
      });

      const result = await runRepairLoop(tmpDir, {
        logger: silentLogger,
        provider: mockProvider,
        maxAttempts: 2,
        applyDirectly: true,
        allowDirty: true,
        config: { customTestCommand: 'node --test test/calc.test.js' }
      });

      assert.equal(result.status, 'max_attempts_reached');
      assert.equal(result.passed, false);
      assert.equal(result.attempts, 2);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('stops immediately when user declines approval', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rep-cancel-'));
    try {
      fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ type: 'module' }));
      fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
      fs.mkdirSync(path.join(tmpDir, 'test'), { recursive: true });

      fs.writeFileSync(path.join(tmpDir, 'src/calc.js'), 'export const add = () => 0;\n');
      fs.writeFileSync(
        path.join(tmpDir, 'test/calc.test.js'),
        "import test from 'node:test'; import assert from 'node:assert'; import { add } from '../src/calc.js'; test('adds', () => assert.equal(add(2, 3), 5));\n"
      );

      const mockProvider = new MockProvider({
        responses: [
          {
            summary: 'Fix addition',
            edits: [{ path: 'src/calc.js', operation: 'replace', content: 'export const add = (a, b) => a + b;\n', reason: 'Fix' }]
          }
        ]
      });

      const result = await runRepairLoop(tmpDir, {
        logger: silentLogger,
        provider: mockProvider,
        applyDirectly: false,
        approvalCallback: async () => false, // User declines
        allowDirty: true,
        config: { customTestCommand: 'node --test test/calc.test.js' }
      });

      assert.equal(result.status, 'cancelled_by_user');
      assert.equal(result.passed, false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('handles provider failures gracefully', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rep-fail-'));
    try {
      fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ type: 'module' }));
      fs.mkdirSync(path.join(tmpDir, 'test'), { recursive: true });
      fs.writeFileSync(
        path.join(tmpDir, 'test/fail.test.js'),
        "import test from 'node:test'; import assert from 'node:assert'; test('fails', () => assert.equal(1, 2));\n"
      );

      const mockProvider = new MockProvider({
        shouldFail: true,
        failMessage: 'Simulated API rate limit'
      });

      const result = await runRepairLoop(tmpDir, {
        logger: silentLogger,
        provider: mockProvider,
        applyDirectly: true,
        allowDirty: true,
        config: { customTestCommand: 'node --test test/fail.test.js' }
      });

      assert.equal(result.status, 'error');
      assert.equal(result.passed, false);
      assert.ok(result.error.includes('Simulated API rate limit'));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
