import path from 'node:path';
import { scanRepository, isExcluded } from './scanner.js';
import { matchGlob } from './utils/fs.js';

const VALID_TEST_EXTENSIONS = new Set([
  '.js', '.cjs', '.mjs', '.jsx',
  '.ts', '.cts', '.mts', '.tsx'
]);

/**
 * Checks if a relative path matches any test pattern
 * @param {string} relPath
 * @param {string[]} patterns
 * @returns {boolean}
 */
export function matchesTestPattern(relPath, patterns) {
  const normPath = relPath.replace(/\\/g, '/');
  const ext = path.extname(normPath).toLowerCase();

  if (!VALID_TEST_EXTENSIONS.has(ext)) {
    return false;
  }

  const basename = path.basename(normPath);

  for (const pattern of patterns) {
    if (matchGlob(pattern, normPath)) {
      return true;
    }
    // Also support simple file basename patterns like "test.js"
    if (!pattern.includes('/') && basename === pattern) {
      return true;
    }
  }

  return false;
}

/**
 * Discovers test files in repository according to configuration
 *
 * @param {string} rootDir
 * @param {object} [config={}]
 * @param {string} [specificTestFilter=null]
 * @returns {Array<{ relativePath: string, fullPath: string, ext: string, isTypeScript: boolean }>}
 */
export function discoverTests(rootDir, config = {}, specificTestFilter = null) {
  const scanned = scanRepository(rootDir, {
    exclude: config.exclude,
    maxFileBytes: config.maxFileBytes
  });

  const testPatterns = config.testPatterns || [
    '**/test.js',
    '**/test.cjs',
    '**/test.mjs',
    '**/test.ts',
    '**/*.test.js',
    '**/*.test.cjs',
    '**/*.test.mjs',
    '**/*.test.jsx',
    '**/*.test.ts',
    '**/*.test.tsx',
    '**/*.spec.js',
    '**/*.spec.cjs',
    '**/*.spec.mjs',
    '**/*.spec.jsx',
    '**/*.spec.ts',
    '**/*.spec.tsx',
    '**/__tests__/**'
  ];

  let testFiles = scanned.filter(file => matchesTestPattern(file.relativePath, testPatterns));

  if (specificTestFilter) {
    const filterNorm = specificTestFilter.replace(/\\/g, '/');
    testFiles = testFiles.filter(file => {
      return file.relativePath === filterNorm ||
             file.relativePath.endsWith('/' + filterNorm) ||
             matchGlob(filterNorm, file.relativePath);
    });
  }

  return testFiles.map(file => {
    const isTypeScript = ['.ts', '.cts', '.mts', '.tsx'].includes(file.ext);
    return {
      relativePath: file.relativePath,
      fullPath: file.fullPath,
      ext: file.ext,
      size: file.size,
      isTypeScript
    };
  });
}
