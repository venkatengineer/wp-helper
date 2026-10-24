import fs from 'node:fs';
import path from 'node:path';
import { safeReadFile, atomicWriteFile, computeFileHash } from './utils/fs.js';
import { validateSafePath } from './utils/security.js';
import { generateUnifiedDiff } from './diff.js';

/**
 * Check for concurrent modifications: verifies that files haven't changed
 * since context was extracted.
 *
 * @param {string} rootDir
 * @param {Array<{ path: string, hash: string|null }>} expectedHashes
 * @returns {{ clean: boolean, conflicts: string[] }}
 */
export function checkConcurrentModifications(rootDir, expectedHashes) {
  const conflicts = [];

  for (const item of expectedHashes) {
    const safeCheck = validateSafePath(rootDir, item.path);
    if (!safeCheck.safe) continue;

    const currentHash = computeFileHash(safeCheck.resolvedPath);
    if (item.hash !== currentHash) {
      conflicts.push(
        `File "${item.path}" was modified after analysis (expected hash ${item.hash || 'none'}, current ${currentHash || 'none'}).`
      );
    }
  }

  return {
    clean: conflicts.length === 0,
    conflicts
  };
}

/**
 * Previews changes and generates unified diffs for all proposed edits
 *
 * @param {string} rootDir
 * @param {Array<{ path: string, operation: string, content: string }>} validatedEdits
 * @param {object} [options]
 * @param {boolean} [options.colorize=false]
 * @returns {Array<{ path: string, diff: string, isNew: boolean }>}
 */
export function previewDiffs(rootDir, validatedEdits, options = {}) {
  const diffs = [];

  for (const edit of validatedEdits) {
    const safeCheck = validateSafePath(rootDir, edit.path);
    if (!safeCheck.safe) continue;

    const fullPath = safeCheck.resolvedPath;
    const exists = fs.existsSync(fullPath);
    const oldContent = exists ? fs.readFileSync(fullPath, 'utf8') : '';
    const newContent = edit.content;

    const diff = generateUnifiedDiff(edit.path, oldContent, newContent, {
      colorize: options.colorize ?? false,
      context: 3
    });

    diffs.push({
      path: edit.path,
      diff,
      isNew: !exists
    });
  }

  return diffs;
}

/**
 * Safely applies validated edits to disk
 *
 * @param {string} rootDir Repository root
 * @param {Array<{ path: string, resolvedPath: string, operation: string, content: string }>} validatedEdits
 * @param {object} [options={}]
 * @param {import('./backup-manager.js').BackupManager} [options.backupManager]
 * @returns {{
 *   success: boolean,
 *   appliedEdits: Array<{ path: string, operation: string }>,
 *   backupId: string|null,
 *   diffs: Array<{ path: string, diff: string }>
 * }}
 */
export function applyPatch(rootDir, validatedEdits, options = {}) {
  const backupManager = options.backupManager;
  let backupId = null;

  // 1. Create pre-patch backup if backup manager is provided
  if (backupManager) {
    const filePaths = validatedEdits.map(e => e.path);
    backupId = backupManager.createBackup(filePaths, 'Automated repair patch');
  }

  const appliedEdits = [];
  const diffs = previewDiffs(rootDir, validatedEdits, { colorize: options.colorize });

  try {
    for (const edit of validatedEdits) {
      const safeCheck = validateSafePath(rootDir, edit.path);
      if (!safeCheck.safe) {
        throw new Error(`Cannot write to unsafe path: ${safeCheck.error}`);
      }

      const fullPath = safeCheck.resolvedPath;

      if (edit.operation === 'create' || edit.operation === 'replace') {
        atomicWriteFile(fullPath, edit.content);
        appliedEdits.push({ path: edit.path, operation: edit.operation });
      } else if (edit.operation === 'patch') {
        // Targeted replacement
        atomicWriteFile(fullPath, edit.content);
        appliedEdits.push({ path: edit.path, operation: 'patch' });
      }
    }

    return {
      success: true,
      appliedEdits,
      backupId,
      diffs
    };
  } catch (err) {
    // If any write failed and we have a backup, roll back automatically
    if (backupManager && backupId) {
      try {
        backupManager.rollback(backupId);
      } catch {
        // ignore secondary rollback error
      }
    }
    throw new Error(`Failed to apply patch: ${err.message}`);
  }
}
