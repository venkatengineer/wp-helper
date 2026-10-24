import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { applyPatch, previewDiffs, checkConcurrentModifications } from '../src/patcher.js';
import { generateUnifiedDiff } from '../src/diff.js';
import { BackupManager } from '../src/backup-manager.js';
import { computeHash } from '../src/utils/fs.js';

describe('Patcher, Unified Diff and Concurrency Checking', () => {
  it('generates standard readable unified diff with line numbers and hunks', () => {
    const oldCode = 'function hello() {\n  return "hi";\n}\n';
    const newCode = 'function hello() {\n  return "hello world";\n}\n';

    const diff = generateUnifiedDiff('src/hello.js', oldCode, newCode);
    assert.ok(diff.includes('--- a/src/hello.js'));
    assert.ok(diff.includes('+++ b/src/hello.js'));
    assert.ok(diff.includes('@@ -1,4 +1,4 @@'));
    assert.ok(diff.includes('-  return "hi";'));
    assert.ok(diff.includes('+  return "hello world";'));
  });

  it('detects concurrent modifications before applying patch', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'concurrent-'));
    try {
      const filePath = path.join(tmpDir, 'src/data.js');
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, 'initial content', 'utf8');

      const initialHash = computeHash('initial content');

      // 1. Unmodified -> clean
      const check1 = checkConcurrentModifications(tmpDir, [{ path: 'src/data.js', hash: initialHash }]);
      assert.equal(check1.clean, true);

      // 2. Modified outside -> conflict detected
      fs.writeFileSync(filePath, 'modified by another process', 'utf8');
      const check2 = checkConcurrentModifications(tmpDir, [{ path: 'src/data.js', hash: initialHash }]);
      assert.equal(check2.clean, false);
      assert.ok(check2.conflicts[0].includes('modified after analysis'));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('applies create and replace edits safely and creates backup', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'patch-apply-'));
    try {
      const bm = new BackupManager(tmpDir);
      const edits = [
        {
          path: 'src/new-file.js',
          resolvedPath: path.join(tmpDir, 'src/new-file.js'),
          operation: 'create',
          content: 'export const status = "created";',
          reason: 'create new file'
        }
      ];

      const result = applyPatch(tmpDir, edits, { backupManager: bm });
      assert.equal(result.success, true);
      assert.ok(result.backupId);
      assert.equal(fs.readFileSync(path.join(tmpDir, 'src/new-file.js'), 'utf8'), 'export const status = "created";');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
