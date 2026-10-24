import path from 'node:path';
import { validateSafePath, isProhibitedFile } from './utils/security.js';
import { matchesTestPattern } from './test-discovery.js';

const ALLOWED_OPERATIONS = new Set(['create', 'replace', 'patch']);

/**
 * Validates the structured edits returned by the AI provider
 *
 * @param {string} rootDir Repository root directory
 * @param {object} aiResponse Response object from provider
 * @param {object} [options={}]
 * @param {string[]} [options.testPatterns]
 * @param {string[]} [options.knownTestFiles]
 * @param {boolean} [options.allowTestEdits=false]
 * @returns {{
 *   valid: boolean,
 *   errors: string[],
 *   summary: string,
 *   validatedEdits: Array<{
 *     path: string,
 *     resolvedPath: string,
 *     operation: 'create'|'replace'|'patch',
 *     content: string,
 *     reason: string
 *   }>,
 *   questions: string[]
 * }}
 */
export function validatePatch(rootDir, aiResponse, options = {}) {
  const errors = [];
  const validatedEdits = [];

  if (!aiResponse || typeof aiResponse !== 'object') {
    return {
      valid: false,
      errors: ['AI response must be an object.'],
      summary: '',
      validatedEdits: [],
      questions: []
    };
  }

  const summary = typeof aiResponse.summary === 'string' ? aiResponse.summary.trim() : '';
  if (!summary) {
    errors.push('AI response is missing a "summary" description.');
  }

  if (!Array.isArray(aiResponse.edits)) {
    errors.push('AI response "edits" must be an array.');
    return {
      valid: false,
      errors,
      summary,
      validatedEdits: [],
      questions: []
    };
  }

  const testPatterns = options.testPatterns || [
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

  const knownTestFiles = new Set((options.knownTestFiles || []).map(p => p.replace(/\\/g, '/')));

  for (let i = 0; i < aiResponse.edits.length; i++) {
    const edit = aiResponse.edits[i];
    const prefix = `Edit [${i}]`;

    if (!edit || typeof edit !== 'object') {
      errors.push(`${prefix}: Must be an object.`);
      continue;
    }

    // 1. Path validation
    if (!edit.path || typeof edit.path !== 'string') {
      errors.push(`${prefix}: Must specify a valid string "path".`);
      continue;
    }

    const safeCheck = validateSafePath(rootDir, edit.path);
    if (!safeCheck.safe) {
      errors.push(`${prefix}: Unsafe file path "${edit.path}": ${safeCheck.error}`);
      continue;
    }

    const normRelPath = safeCheck.relativePath;

    // 2. Reject modifying test files unless explicitly allowed (safety rule)
    if (!options.allowTestEdits) {
      if (knownTestFiles.has(normRelPath) || matchesTestPattern(normRelPath, testPatterns)) {
        errors.push(
          `${prefix}: Safety violation - proposed edit targets test file "${normRelPath}". ` +
          `AI is prohibited from modifying or weakening test files to make tests pass.`
        );
        continue;
      }
    }

    // 3. Prohibited files check
    if (isProhibitedFile(normRelPath)) {
      errors.push(`${prefix}: Target file "${normRelPath}" is prohibited from modification.`);
      continue;
    }

    // 4. Operation validation
    const op = (edit.operation || '').toLowerCase();
    if (!ALLOWED_OPERATIONS.has(op)) {
      errors.push(`${prefix}: Unsupported operation "${edit.operation}". Allowed: ${Array.from(ALLOWED_OPERATIONS).join(', ')}.`);
      continue;
    }

    // 5. Content validation
    if (typeof edit.content !== 'string') {
      errors.push(`${prefix}: Content must be a string.`);
      continue;
    }

    // 6. Reason validation
    const reason = typeof edit.reason === 'string' ? edit.reason.trim() : '';

    validatedEdits.push({
      path: normRelPath,
      resolvedPath: safeCheck.resolvedPath,
      operation: op,
      content: edit.content,
      reason
    });
  }

  const questions = Array.isArray(aiResponse.questions)
    ? aiResponse.questions.filter(q => typeof q === 'string')
    : [];

  return {
    valid: errors.length === 0,
    errors,
    summary,
    validatedEdits,
    questions
  };
}
