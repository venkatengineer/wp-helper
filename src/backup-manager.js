import fs from 'node:fs';
import path from 'node:path';
import { safeReadFile, atomicWriteFile, safeDeleteFile, computeHash } from './utils/fs.js';
import { validateSafePath } from './utils/security.js';

export const BACKUP_DIR_NAME = '.ai-test-fixer/backups';

export class BackupManager {
  /**
   * @param {string} rootDir
   */
  constructor(rootDir) {
    this.rootDir = path.resolve(rootDir);
    this.backupBaseDir = path.join(this.rootDir, BACKUP_DIR_NAME);
  }

  /**
   * Ensures backup directory exists
   * @private
   */
  _ensureBackupDir() {
    if (!fs.existsSync(this.backupBaseDir)) {
      fs.mkdirSync(this.backupBaseDir, { recursive: true });
    }
  }

  /**
   * Create a snapshot backup for a set of file paths
   * @param {string[]} fileRelativePaths
   * @param {string} [reason='Pre-patch backup']
   * @returns {string} Backup ID
   */
  createBackup(fileRelativePaths, reason = 'Pre-patch backup') {
    this._ensureBackupDir();

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const randomSuffix = Math.random().toString(36).substring(2, 8);
    const backupId = `backup-${timestamp}-${randomSuffix}`;
    const backupDir = path.join(this.backupBaseDir, backupId);
    fs.mkdirSync(backupDir, { recursive: true });

    const manifestFiles = [];

    for (const relPath of fileRelativePaths) {
      const safeCheck = validateSafePath(this.rootDir, relPath);
      if (!safeCheck.safe) continue;

      const fullPath = safeCheck.resolvedPath;
      const fileRecord = {
        path: safeCheck.relativePath,
        existed: false,
        hash: null,
        backupFile: null
      };

      if (fs.existsSync(fullPath)) {
        try {
          const content = fs.readFileSync(fullPath, 'utf8');
          const hash = computeHash(content);
          // Store copy in backup directory
          const encodedName = Buffer.from(safeCheck.relativePath).toString('hex') + '.bak';
          fs.writeFileSync(path.join(backupDir, encodedName), content, 'utf8');

          fileRecord.existed = true;
          fileRecord.hash = hash;
          fileRecord.backupFile = encodedName;
        } catch (err) {
          throw new Error(`Failed to create backup for "${relPath}": ${err.message}`);
        }
      }

      manifestFiles.push(fileRecord);
    }

    const manifest = {
      id: backupId,
      createdAt: new Date().toISOString(),
      reason,
      files: manifestFiles
    };

    fs.writeFileSync(
      path.join(backupDir, 'manifest.json'),
      JSON.stringify(manifest, null, 2),
      'utf8'
    );

    return backupId;
  }

  /**
   * List available backups sorted descending by date
   * @returns {Array<{ id: string, createdAt: string, reason: string, fileCount: number }>}
   */
  listBackups() {
    if (!fs.existsSync(this.backupBaseDir)) {
      return [];
    }

    const entries = fs.readdirSync(this.backupBaseDir, { withFileTypes: true });
    const backups = [];

    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.startsWith('backup-')) {
        const manifestPath = path.join(this.backupBaseDir, entry.name, 'manifest.json');
        if (fs.existsSync(manifestPath)) {
          try {
            const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
            backups.push({
              id: manifest.id,
              createdAt: manifest.createdAt,
              reason: manifest.reason,
              fileCount: manifest.files ? manifest.files.length : 0
            });
          } catch {
            // Ignore malformed manifests
          }
        }
      }
    }

    return backups.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  /**
   * Rollback repository files using the specified or most recent backup
   * @param {string} [backupId] Optional specific backup ID. If omitted, uses latest.
   * @returns {{ success: boolean, backupId: string, restoredFiles: string[] }}
   */
  rollback(backupId = null) {
    if (!backupId) {
      const list = this.listBackups();
      if (list.length === 0) {
        throw new Error('No backups found to rollback.');
      }
      backupId = list[0].id;
    }

    const backupDir = path.join(this.backupBaseDir, backupId);
    const manifestPath = path.join(backupDir, 'manifest.json');

    if (!fs.existsSync(manifestPath)) {
      throw new Error(`Backup "${backupId}" not found or corrupt.`);
    }

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const restoredFiles = [];

    for (const fileRecord of manifest.files) {
      const safeCheck = validateSafePath(this.rootDir, fileRecord.path);
      if (!safeCheck.safe) continue;

      const fullPath = safeCheck.resolvedPath;

      if (fileRecord.existed && fileRecord.backupFile) {
        const savedPath = path.join(backupDir, fileRecord.backupFile);
        if (fs.existsSync(savedPath)) {
          const originalContent = fs.readFileSync(savedPath, 'utf8');
          atomicWriteFile(fullPath, originalContent);
          restoredFiles.push(fileRecord.path);
        }
      } else if (!fileRecord.existed) {
        // File did not exist before patch - remove it
        safeDeleteFile(fullPath);
        restoredFiles.push(fileRecord.path + ' (deleted)');
      }
    }

    return {
      success: true,
      backupId,
      restoredFiles
    };
  }
}
