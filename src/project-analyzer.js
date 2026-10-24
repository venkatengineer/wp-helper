import fs from 'node:fs';
import path from 'node:path';

/**
 * Detects the package manager used in the project
 * @param {string} rootDir
 * @returns {'pnpm' | 'yarn' | 'npm'}
 */
export function detectPackageManager(rootDir) {
  if (fs.existsSync(path.join(rootDir, 'pnpm-lock.yaml'))) {
    return 'pnpm';
  }
  if (fs.existsSync(path.join(rootDir, 'yarn.lock'))) {
    return 'yarn';
  }
  return 'npm';
}

/**
 * Detects workspace / monorepo configuration
 * @param {string} rootDir
 * @param {object} packageJson
 * @returns {{ isMonorepo: boolean, type: string|null, packages?: string[] }}
 */
export function detectWorkspaces(rootDir, packageJson) {
  if (packageJson && packageJson.workspaces) {
    const packages = Array.isArray(packageJson.workspaces)
      ? packageJson.workspaces
      : packageJson.workspaces.packages || [];
    return { isMonorepo: true, type: 'npm-or-yarn-workspaces', packages };
  }
  if (fs.existsSync(path.join(rootDir, 'pnpm-workspace.yaml'))) {
    return { isMonorepo: true, type: 'pnpm-workspaces' };
  }
  if (fs.existsSync(path.join(rootDir, 'lerna.json'))) {
    return { isMonorepo: true, type: 'lerna' };
  }
  if (fs.existsSync(path.join(rootDir, 'turbo.json'))) {
    return { isMonorepo: true, type: 'turborepo' };
  }
  return { isMonorepo: false, type: null };
}

/**
 * Detects module system and TypeScript configuration
 * @param {string} rootDir
 * @param {object} packageJson
 * @returns {{ moduleType: 'esm'|'commonjs', isTypeScript: boolean, tsConfigPath: string|null }}
 */
export function detectModuleSystem(rootDir, packageJson) {
  const moduleType = packageJson && packageJson.type === 'module' ? 'esm' : 'commonjs';
  const tsConfigPath = path.join(rootDir, 'tsconfig.json');
  const isTypeScript = fs.existsSync(tsConfigPath);

  return {
    moduleType,
    isTypeScript,
    tsConfigPath: isTypeScript ? tsConfigPath : null
  };
}

/**
 * Detects the test framework and configuration
 * @param {string} rootDir
 * @param {object} packageJson
 * @returns {{ framework: 'jest'|'vitest'|'mocha'|'node-test'|'unknown', testScript: string|null, configFile: string|null }}
 */
export function detectTestFramework(rootDir, packageJson) {
  const scripts = (packageJson && packageJson.scripts) || {};
  const testScript = scripts.test || null;
  const allDeps = {
    ...(packageJson && packageJson.dependencies),
    ...(packageJson && packageJson.devDependencies)
  };

  // 1. Vitest check
  const vitestConfigs = ['vitest.config.ts', 'vitest.config.js', 'vitest.config.mjs', 'vitest.config.mts'];
  for (const cfg of vitestConfigs) {
    if (fs.existsSync(path.join(rootDir, cfg))) {
      return { framework: 'vitest', testScript, configFile: cfg };
    }
  }
  if (allDeps['vitest'] || (testScript && testScript.includes('vitest'))) {
    return { framework: 'vitest', testScript, configFile: null };
  }

  // 2. Jest check
  const jestConfigs = ['jest.config.js', 'jest.config.ts', 'jest.config.json', 'jest.config.mjs', 'jest.config.cjs'];
  for (const cfg of jestConfigs) {
    if (fs.existsSync(path.join(rootDir, cfg))) {
      return { framework: 'jest', testScript, configFile: cfg };
    }
  }
  if (allDeps['jest'] || (testScript && testScript.includes('jest'))) {
    return { framework: 'jest', testScript, configFile: null };
  }

  // 3. Mocha check
  const mochaConfigs = ['.mocharc.json', '.mocharc.js', '.mocharc.yaml', '.mocharc.yml'];
  for (const cfg of mochaConfigs) {
    if (fs.existsSync(path.join(rootDir, cfg))) {
      return { framework: 'mocha', testScript, configFile: cfg };
    }
  }
  if (allDeps['mocha'] || (testScript && testScript.includes('mocha'))) {
    return { framework: 'mocha', testScript, configFile: null };
  }

  // 4. Node.js built-in test runner
  if (testScript && (testScript.includes('node --test') || testScript.startsWith('node:test'))) {
    return { framework: 'node-test', testScript, configFile: null };
  }

  // If no test script but node:test is available and tests exist
  return { framework: 'unknown', testScript, configFile: null };
}

/**
 * Reads package.json if it exists
 * @param {string} rootDir
 * @returns {object|null}
 */
export function readPackageJson(rootDir) {
  const pkgPath = path.join(rootDir, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Performs full project context and environment analysis
 * @param {string} rootDir
 * @returns {object}
 */
export function analyzeProject(rootDir) {
  const packageJson = readPackageJson(rootDir);
  const packageManager = detectPackageManager(rootDir);
  const workspaceInfo = detectWorkspaces(rootDir, packageJson);
  const moduleInfo = detectModuleSystem(rootDir, packageJson);
  const frameworkInfo = detectTestFramework(rootDir, packageJson);

  return {
    rootDir: path.resolve(rootDir),
    packageJson,
    packageManager,
    isMonorepo: workspaceInfo.isMonorepo,
    workspaceType: workspaceInfo.type,
    moduleType: moduleInfo.moduleType,
    isTypeScript: moduleInfo.isTypeScript,
    testFramework: frameworkInfo.framework,
    testScript: frameworkInfo.testScript,
    frameworkConfigFile: frameworkInfo.configFile
  };
}
