import fs from 'node:fs';
import path from 'node:path';
import { safeReadFile, computeHash } from './utils/fs.js';
import { validateSafePath, isProhibitedFile, maskSecrets } from './utils/security.js';
import { analyzeProject } from './project-analyzer.js';

const EXTENSIONS_TO_TRY = ['.js', '.ts', '.mjs', '.cjs', '.jsx', '.tsx', '/index.js', '/index.ts'];

/**
 * Extract relative import or require paths from source code
 * @param {string} sourceCode
 * @returns {string[]}
 */
export function extractImportPaths(sourceCode) {
  const imports = new Set();

  // Match ESM: import ... from '...' or import '...'
  const esmRegex = /(?:import\s+(?:[\w*\s{},]*\s+from\s+)?|export\s+(?:[\w*\s{},]*\s+from\s+)?)['"]([^'"]+)['"]/g;
  let match;
  while ((match = esmRegex.exec(sourceCode)) !== null) {
    imports.add(match[1]);
  }

  // Match dynamic import('...')
  const dynamicImportRegex = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((match = dynamicImportRegex.exec(sourceCode)) !== null) {
    imports.add(match[1]);
  }

  // Match CommonJS: require('...')
  const cjsRegex = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((match = cjsRegex.exec(sourceCode)) !== null) {
    imports.add(match[1]);
  }

  // Filter to relative local paths (starts with . or ..)
  return Array.from(imports).filter(imp => imp.startsWith('.'));
}

/**
 * Resolves an imported relative specifier from test file to repository relative path
 *
 * @param {string} rootDir
 * @param {string} testRelativePath
 * @param {string} importSpecifier
 * @returns {{ resolvedRelPath: string, exists: boolean }}
 */
export function resolveImportTarget(rootDir, testRelativePath, importSpecifier) {
  const testDir = path.dirname(path.resolve(rootDir, testRelativePath));
  const candidateBase = path.resolve(testDir, importSpecifier);

  // 1. Direct match
  if (fs.existsSync(candidateBase) && fs.statSync(candidateBase).isFile()) {
    const rel = path.relative(rootDir, candidateBase).replace(/\\/g, '/');
    return { resolvedRelPath: rel, exists: true };
  }

  // 2. Try extensions
  for (const ext of EXTENSIONS_TO_TRY) {
    const withExt = candidateBase + ext;
    if (fs.existsSync(withExt) && fs.statSync(withExt).isFile()) {
      const rel = path.relative(rootDir, withExt).replace(/\\/g, '/');
      return { resolvedRelPath: rel, exists: true };
    }
  }

  // 3. If file does not exist, determine likely target path
  let likelyPath = candidateBase;
  if (!path.extname(candidateBase)) {
    // If test is TypeScript, prefer .ts, else .js
    const isTsTest = /\.(ts|tsx|cts|mts)$/.test(testRelativePath);
    likelyPath += isTsTest ? '.ts' : '.js';
  }

  const rel = path.relative(rootDir, likelyPath).replace(/\\/g, '/');
  return { resolvedRelPath: rel, exists: false };
}

/**
 * Builds the context payload for AI model
 *
 * @param {string} rootDir
 * @param {string} testFilePath
 * @param {object} [options={}]
 * @param {object} [options.testFailures]
 * @param {number} [options.maxFileBytes=100000]
 * @param {number} [options.maxContextTokens=32000]
 * @returns {object} Context payload
 */
export function buildContext(rootDir, testFilePath, options = {}) {
  const maxFileBytes = options.maxFileBytes || 100000;
  const projectInfo = analyzeProject(rootDir);

  const testPathCheck = validateSafePath(rootDir, testFilePath);
  if (!testPathCheck.safe) {
    throw new Error(`Invalid test file path: ${testPathCheck.error}`);
  }

  // Read test file
  const testContent = safeReadFile(testPathCheck.resolvedPath, maxFileBytes);
  const testHash = computeHash(testContent);

  // Extract imports and identify target implementation files
  const importSpecifiers = extractImportPaths(testContent);
  const implementationFiles = [];

  for (const specifier of importSpecifiers) {
    const resolved = resolveImportTarget(rootDir, testPathCheck.relativePath, specifier);
    const safeCheck = validateSafePath(rootDir, resolved.resolvedRelPath);

    if (!safeCheck.safe) {
      continue;
    }

    if (isProhibitedFile(resolved.resolvedRelPath)) {
      continue;
    }

    if (resolved.exists) {
      try {
        const content = safeReadFile(safeCheck.resolvedPath, maxFileBytes);
        const hash = computeHash(content);
        implementationFiles.push({
          path: resolved.resolvedRelPath,
          content,
          exists: true,
          hash,
          isTarget: true
        });
      } catch (err) {
        // Skip unreadable files
      }
    } else {
      // Missing file that test is attempting to import
      implementationFiles.push({
        path: resolved.resolvedRelPath,
        content: '',
        exists: false,
        hash: null,
        isTarget: true
      });
    }
  }

  // Extract clean package.json info (dependencies and type)
  const pkgSummary = projectInfo.packageJson ? {
    name: projectInfo.packageJson.name,
    type: projectInfo.packageJson.type || 'commonjs',
    dependencies: Object.keys(projectInfo.packageJson.dependencies || {}),
    devDependencies: Object.keys(projectInfo.packageJson.devDependencies || {})
  } : null;

  return {
    rootDir: path.resolve(rootDir),
    testFile: {
      path: testPathCheck.relativePath,
      content: testContent,
      hash: testHash,
      isTypeScript: projectInfo.isTypeScript || /\.(ts|tsx)$/.test(testPathCheck.relativePath)
    },
    implementationFiles,
    testFailures: options.testFailures || null,
    projectMeta: {
      moduleType: projectInfo.moduleType,
      isTypeScript: projectInfo.isTypeScript,
      packageManager: projectInfo.packageManager,
      testFramework: projectInfo.testFramework,
      packageJson: pkgSummary
    }
  };
}
