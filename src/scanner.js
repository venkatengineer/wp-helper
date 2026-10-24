import fs from 'node:fs';
import path from 'node:path';
import { matchGlob } from './utils/fs.js';

// Common binary and generated extensions to skip during scanning
const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico',
  '.pdf', '.zip', '.tar', '.gz', '.tgz', '.wasm', '.node',
  '.exe', '.dll', '.so', '.dylib', '.woff', '.woff2', '.ttf',
  '.mp3', '.mp4', '.avi', '.mov', '.map', '.lock'
]);

/**
 * Checks if a relative path matches any exclusion patterns
 * @param {string} relPath
 * @param {string[]} excludePatterns
 * @returns {boolean}
 */
export function isExcluded(relPath, excludePatterns) {
  const normalized = relPath.replace(/\\/g, '/');
  for (const pattern of excludePatterns) {
    if (matchGlob(pattern, normalized)) return true;
    // Also match if any parent directory matches pattern without trailing /**
    const cleanPattern = pattern.replace(/\/\*\*$/, '');
    if (normalized === cleanPattern || normalized.startsWith(cleanPattern + '/')) {
      return true;
    }
  }
  return false;
}

/**
 * Recursively scans directory and yields all valid candidate files
 *
 * @param {string} rootDir
 * @param {object} options
 * @param {string[]} [options.exclude]
 * @param {number} [options.maxFileBytes]
 * @returns {Array<{ relativePath: string, fullPath: string, size: number, ext: string }>}
 */
export function scanRepository(rootDir, options = {}) {
  const resolvedRoot = path.resolve(rootDir);
  const excludePatterns = options.exclude || [
    'node_modules/**',
    '.git/**',
    'dist/**',
    'build/**',
    'coverage/**',
    '.nyc_output/**',
    '.cache/**',
    '.ai-test-fixer/**'
  ];
  const maxFileBytes = options.maxFileBytes || 1000000;

  const results = [];
  const visitedRealPaths = new Set();

  function traverse(currentDir) {
    let entries;
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      const relPath = path.relative(resolvedRoot, fullPath).replace(/\\/g, '/');

      // Check exclusion
      if (isExcluded(relPath, excludePatterns)) {
        continue;
      }

      // Check realpath to avoid symlink cycles or symlink escapes
      let realPath;
      try {
        realPath = fs.realpathSync(fullPath);
      } catch {
        continue;
      }

      const realRel = path.relative(resolvedRoot, realPath);
      if (realRel.startsWith('..') || path.isAbsolute(realRel)) {
        // Symlink points outside root - skip
        continue;
      }

      if (visitedRealPaths.has(realPath)) {
        // Prevent cyclic traversal
        continue;
      }
      visitedRealPaths.add(realPath);

      try {
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
          traverse(fullPath);
        } else if (stat.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (BINARY_EXTENSIONS.has(ext)) {
            continue;
          }
          if (stat.size > maxFileBytes) {
            continue;
          }

          results.push({
            relativePath: relPath,
            fullPath,
            size: stat.size,
            ext
          });
        }
      } catch {
        // Ignore unreadable files
      }
    }
  }

  traverse(resolvedRoot);
  return results;
}
