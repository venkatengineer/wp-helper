import fs from 'node:fs';
import path from 'node:path';

export const CONFIG_FILE_NAMES = [
  'ai-test-fixer.config.json',
  '.ai-test-fixerrc.json',
  '.ai-test-fixerrc'
];

export const DEFAULT_CONFIG = {
  provider: 'openai',
  model: 'gpt-4.1-mini',
  maxAttempts: 3,
  approvalRequired: true,
  testPatterns: [
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
  ],
  exclude: [
    'node_modules/**',
    '.git/**',
    'dist/**',
    'build/**',
    'coverage/**',
    '.nyc_output/**',
    '.cache/**',
    '.ai-test-fixer/**'
  ],
  maxFileBytes: 100000,
  maxContextTokens: 32000,
  testTimeoutMs: 120000,
  allowDirty: false,
  customTestCommand: null
};

/**
 * Validates a configuration object and returns a list of error messages.
 * @param {object} config
 * @returns {string[]} Array of error strings
 */
export function validateConfig(config) {
  const errors = [];
  if (typeof config !== 'object' || config === null) {
    return ['Configuration must be a valid JSON object.'];
  }

  if (config.provider && typeof config.provider !== 'string') {
    errors.push('Option "provider" must be a string.');
  }

  if (config.model && typeof config.model !== 'string') {
    errors.push('Option "model" must be a string.');
  }

  if (config.maxAttempts !== undefined) {
    if (!Number.isInteger(config.maxAttempts) || config.maxAttempts < 1 || config.maxAttempts > 20) {
      errors.push('Option "maxAttempts" must be an integer between 1 and 20.');
    }
  }

  if (config.approvalRequired !== undefined && typeof config.approvalRequired !== 'boolean') {
    errors.push('Option "approvalRequired" must be a boolean.');
  }

  if (config.testPatterns !== undefined) {
    if (!Array.isArray(config.testPatterns) || config.testPatterns.length === 0 || !config.testPatterns.every(p => typeof p === 'string' && p.trim().length > 0)) {
      errors.push('Option "testPatterns" must be a non-empty array of pattern strings.');
    }
  }

  if (config.exclude !== undefined) {
    if (!Array.isArray(config.exclude) || !config.exclude.every(p => typeof p === 'string')) {
      errors.push('Option "exclude" must be an array of pattern strings.');
    }
  }

  if (config.maxFileBytes !== undefined) {
    if (!Number.isInteger(config.maxFileBytes) || config.maxFileBytes < 1024) {
      errors.push('Option "maxFileBytes" must be an integer greater than or equal to 1024.');
    }
  }

  if (config.testTimeoutMs !== undefined) {
    if (!Number.isInteger(config.testTimeoutMs) || config.testTimeoutMs < 1000) {
      errors.push('Option "testTimeoutMs" must be an integer of at least 1000ms.');
    }
  }

  if (config.customTestCommand !== undefined && config.customTestCommand !== null) {
    if (typeof config.customTestCommand !== 'string' || config.customTestCommand.trim().length === 0) {
      errors.push('Option "customTestCommand" must be a non-empty string or null.');
    }
  }

  return errors;
}

/**
 * Searches for configuration file in rootDir
 * @param {string} rootDir
 * @returns {string|null} Path to found config file
 */
export function findConfigFile(rootDir) {
  for (const name of CONFIG_FILE_NAMES) {
    const fullPath = path.resolve(rootDir, name);
    if (fs.existsSync(fullPath)) {
      return fullPath;
    }
  }
  return null;
}

/**
 * Loads configuration from file if present, merges with defaults and overrides
 * @param {string} rootDir
 * @param {object} [overrides={}]
 * @returns {object} Full resolved configuration
 */
export function loadConfig(rootDir = process.cwd(), overrides = {}) {
  let fileConfig = {};
  const configPath = findConfigFile(rootDir);

  if (configPath) {
    try {
      const raw = fs.readFileSync(configPath, 'utf8');
      fileConfig = JSON.parse(raw);
    } catch (err) {
      throw new Error(`Failed to parse config file at "${configPath}": ${err.message}`);
    }

    const validationErrors = validateConfig(fileConfig);
    if (validationErrors.length > 0) {
      throw new Error(`Invalid configuration in "${configPath}":\n- ${validationErrors.join('\n- ')}`);
    }
  }

  // Combine defaults, fileConfig, env vars, overrides
  const merged = {
    ...DEFAULT_CONFIG,
    ...fileConfig,
    ...overrides
  };

  // Provider credentials from env
  merged.apiKey = overrides.apiKey || process.env.OPENAI_API_KEY || fileConfig.apiKey || '';
  merged.baseUrl = overrides.baseUrl || process.env.OPENAI_BASE_URL || fileConfig.baseUrl || 'https://api.openai.com/v1';

  const finalErrors = validateConfig(merged);
  if (finalErrors.length > 0) {
    throw new Error(`Invalid combined configuration:\n- ${finalErrors.join('\n- ')}`);
  }

  return merged;
}
