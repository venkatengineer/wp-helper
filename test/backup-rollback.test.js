import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { BackupManager } from '../src/backup-manager.js';

describe('Backup and Rollback Manager', () => {
  it('creates backup and rolls back both modified and newly created files', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-test-'));
    try {
      const srcDir = path.join(tmpDir, 'src');
      fs.mkdirSync(srcDir, { recursive: true });

      const existingFile = path.join(srcDir, 'math.js');
      const originalContent = 'export function add(a, b) { return a + b; }';
      fs.writeFileSync(existingFile, originalContent, 'utf8');

      const newFile = path.join(srcDir, 'helper.js'); // Does not exist initially

      const backupManager = new BackupManager(tmpDir);

      // 1. Create backup
      const backupId = backupManager.createBackup(['src/math.js', 'src/helper.js'], 'Test backup');
      assert.ok(backupId.startsWith('backup-'));

      // 2. Modify existing file and create new file
      fs.writeFileSync(existingFile, 'corrupted content', 'utf8');
      fs.writeFileSync(newFile, 'new file content', 'utf8');

      assert.equal(fs.readFileSync(existingFile, 'utf8'), 'corrupted content');
      assert.ok(fs.existsSync(newFile));

      // 3. Rollback
      const rollbackResult = backupManager.rollback(backupId);
      assert.equal(rollbackResult.success, true);
      assert.equal(rollbackResult.backupId, backupId);

      // Verify existing file restored
      assert.equal(fs.readFileSync(existingFile, 'utf8'), originalContent);

      // Verify newly created file was deleted
      assert.equal(fs.existsSync(newFile), false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('lists existing backups and rolls back latest when no ID specified', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-list-'));
    try {
      const file = path.join(tmpDir, 'file.txt');
      fs.writeFileSync(file, 'v1', 'utf8');

      const bm = new BackupManager(tmpDir);
      const id1 = bm.createBackup(['file.txt'], 'v1 backup');

      fs.writeFileSync(file, 'v2', 'utf8');
      const id2 = bm.createBackup(['file.txt'], 'v2 backup');

      const backups = bm.listBackups();
      assert.equal(backups.length, 2);
      assert.equal(backups[0].id, id2); // most recent first

      // Change file to v3
      fs.writeFileSync(file, 'v3', 'utf8');

      // Rollback without id should restore latest (id2 -> 'v2')
      bm.rollback();
      assert.equal(fs.readFileSync(file, 'utf8'), 'v2');

      // Rollback to id1 should restore 'v1'
      bm.rollback(id1);
      assert.equal(fs.readFileSync(file, 'utf8'), 'v1');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
