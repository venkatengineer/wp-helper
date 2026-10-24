import path from 'node:path';
import { discoverTests } from './test-discovery.js';
import { runTests } from './test-runner.js';
import { buildContext } from './context-builder.js';
import { validatePatch } from './patch-validator.js';
import { previewDiffs, applyPatch, checkConcurrentModifications } from './patcher.js';
import { BackupManager } from './backup-manager.js';
import { createProvider } from './provider-manager.js';
import { getGitStatus } from './utils/git.js';
import { logger as defaultLogger } from './logger.js';

/**
 * Execute the autonomous test repair loop
 *
 * @param {string} rootDir
 * @param {object} [options={}]
 * @param {object} [options.config]
 * @param {import('./providers/base.js').BaseProvider} [options.provider]
 * @param {import('./logger.js').Logger} [options.logger]
 * @param {string} [options.testFilter]
 * @param {number} [options.maxAttempts]
 * @param {boolean} [options.applyDirectly=false]
 * @param {Function} [options.approvalCallback]
 * @param {boolean} [options.allowDirty=false]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<{
 *   status: 'success' | 'already_passing' | 'max_attempts_reached' | 'cancelled_by_user' | 'error',
 *   passed: boolean,
 *   attempts: number,
 *   modifiedFiles: string[],
 *   backupId: string|null,
 *   error?: string,
 *   usage?: { promptTokens: number, completionTokens: number, totalTokens: number }
 * }>}
 */
export async function runRepairLoop(rootDir, options = {}) {
  const root = path.resolve(rootDir);
  const config = options.config || {};
  const logger = options.logger || defaultLogger;
  const maxAttempts = options.maxAttempts ?? config.maxAttempts ?? 3;
  const applyDirectly = options.applyDirectly ?? !config.approvalRequired;
  const signal = options.signal;

  // 1. Check Git status
  const gitStatus = getGitStatus(root);
  if (gitStatus.isGit && !gitStatus.clean && !options.allowDirty && !config.allowDirty) {
    logger.warn(`Working tree has ${gitStatus.uncommittedFiles.length} uncommitted changes.`);
    logger.warn('Recommended: commit or stash your changes before running auto-repairs, or use --allow-dirty.');
  }

  // 2. Discover tests
  logger.step(1, 4, 'Discovering test files...');
  const discovered = discoverTests(root, config, options.testFilter);

  if (discovered.length === 0) {
    const msg = options.testFilter
      ? `No test files found matching filter "${options.testFilter}".`
      : 'No test files discovered in repository.';
    logger.error(msg);
    return {
      status: 'error',
      passed: false,
      attempts: 0,
      modifiedFiles: [],
      backupId: null,
      error: msg
    };
  }

  const testFilePaths = discovered.map(t => t.relativePath);
  logger.info(`Discovered ${testFilePaths.length} test file(s): ${testFilePaths.slice(0, 3).join(', ')}${testFilePaths.length > 3 ? '...' : ''}`);

  // 3. Establish baseline test run
  logger.step(2, 4, 'Running baseline test check...');
  let baselineResult;
  try {
    baselineResult = await runTests(root, {
      testFiles: testFilePaths,
      customTestCommand: config.customTestCommand,
      timeoutMs: config.testTimeoutMs,
      signal
    });
  } catch (err) {
    logger.error(`Failed to execute baseline test command: ${err.message}`);
    return {
      status: 'error',
      passed: false,
      attempts: 0,
      modifiedFiles: [],
      backupId: null,
      error: err.message
    };
  }

  if (baselineResult.passed) {
    logger.success('All tests are already passing at baseline! No repair needed.');
    return {
      status: 'already_passing',
      passed: true,
      attempts: 0,
      modifiedFiles: [],
      backupId: null
    };
  }

  logger.warn(`Baseline tests failed (exit code ${baselineResult.exitCode}). Starting repair loop...`);
  if (baselineResult.failedTests.length > 0) {
    logger.info(`Failed tests:\n  - ${baselineResult.failedTests.join('\n  - ')}`);
  }

  // 4. Initialize Provider and Backup Manager
  const provider = options.provider || createProvider(config.provider, config);
  const backupManager = new BackupManager(root);

  let currentFailures = {
    failedTests: baselineResult.failedTests,
    assertionErrors: baselineResult.assertionErrors,
    stackTraces: baselineResult.stackTraces,
    rawOutput: baselineResult.rawOutput
  };

  const cumulativeUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  const allModifiedFiles = new Set();
  let latestBackupId = null;

  // Primary test file to target (first discovered or specified)
  const targetTestFile = testFilePaths[0];

  // 5. Repair iterations
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (signal && signal.aborted) {
      logger.warn('Repair loop cancelled by user.');
      return {
        status: 'cancelled_by_user',
        passed: false,
        attempts: attempt - 1,
        modifiedFiles: Array.from(allModifiedFiles),
        backupId: latestBackupId
      };
    }

    logger.step(3, 4, `Repair attempt [${attempt}/${maxAttempts}] - Analyzing context & querying AI...`);

    // Build context
    const context = buildContext(root, targetTestFile, {
      testFailures: currentFailures,
      maxFileBytes: config.maxFileBytes,
      maxContextTokens: config.maxContextTokens
    });

    // Capture file hashes before AI call to detect concurrent modifications
    const preFlightHashes = context.implementationFiles.map(f => ({
      path: f.path,
      hash: f.hash
    }));

    // Call AI Provider
    let aiResponse;
    try {
      aiResponse = await provider.generateEdits(context, { signal });
    } catch (err) {
      logger.error(`AI provider failed: ${err.message}`);
      return {
        status: 'error',
        passed: false,
        attempts: attempt,
        modifiedFiles: Array.from(allModifiedFiles),
        backupId: latestBackupId,
        error: err.message
      };
    }

    if (aiResponse.usage) {
      cumulativeUsage.promptTokens += aiResponse.usage.promptTokens || 0;
      cumulativeUsage.completionTokens += aiResponse.usage.completionTokens || 0;
      cumulativeUsage.totalTokens += aiResponse.usage.totalTokens || 0;
    }

    // Validate proposed patch
    const validation = validatePatch(root, aiResponse, {
      testPatterns: config.testPatterns,
      knownTestFiles: testFilePaths
    });

    if (!validation.valid) {
      logger.error(`Patch validation failed:\n  - ${validation.errors.join('\n  - ')}`);
      if (attempt === maxAttempts) {
        return {
          status: 'error',
          passed: false,
          attempts: attempt,
          modifiedFiles: Array.from(allModifiedFiles),
          backupId: latestBackupId,
          error: `Patch validation failed: ${validation.errors.join('; ')}`
        };
      }
      continue;
    }

    if (validation.validatedEdits.length === 0) {
      logger.warn('AI could not identify any code edits.');
      if (validation.questions.length > 0) {
        logger.info(`AI questions for clarification:\n  - ${validation.questions.join('\n  - ')}`);
      }
      return {
        status: 'error',
        passed: false,
        attempts: attempt,
        modifiedFiles: Array.from(allModifiedFiles),
        backupId: latestBackupId,
        error: 'AI did not propose any code modifications.'
      };
    }

    // Check for concurrent modifications
    const concurrency = checkConcurrentModifications(root, preFlightHashes);
    if (!concurrency.clean) {
      logger.error(`Concurrent file modification detected:\n  - ${concurrency.conflicts.join('\n  - ')}`);
      return {
        status: 'error',
        passed: false,
        attempts: attempt,
        modifiedFiles: Array.from(allModifiedFiles),
        backupId: latestBackupId,
        error: 'Concurrent file changes detected.'
      };
    }

    // Preview diffs
    logger.info(`AI Summary: ${validation.summary}`);
    const diffPreviews = previewDiffs(root, validation.validatedEdits, { colorize: logger.useColors });
    for (const preview of diffPreviews) {
      logger.log(`\nDiff for ${preview.path}:`);
      logger.diff(preview.diff);
    }

    // Check for approval if required
    if (!applyDirectly) {
      if (typeof options.approvalCallback === 'function') {
        const approved = await options.approvalCallback({
          summary: validation.summary,
          diffs: diffPreviews,
          attempt
        });
        if (!approved) {
          logger.warn('Changes rejected by user. Aborting repair.');
          return {
            status: 'cancelled_by_user',
            passed: false,
            attempts: attempt,
            modifiedFiles: Array.from(allModifiedFiles),
            backupId: latestBackupId
          };
        }
      }
    }

    // Apply patch
    logger.step(4, 4, `Applying patch and re-testing [${attempt}/${maxAttempts}]...`);
    const patchResult = applyPatch(root, validation.validatedEdits, {
      backupManager,
      colorize: logger.useColors
    });

    latestBackupId = patchResult.backupId;
    for (const applied of patchResult.appliedEdits) {
      allModifiedFiles.add(applied.path);
    }

    // Run tests again
    const postPatchTestResult = await runTests(root, {
      testFiles: testFilePaths,
      customTestCommand: config.customTestCommand,
      timeoutMs: config.testTimeoutMs,
      signal
    });

    if (postPatchTestResult.passed) {
      logger.success(`Tests passed successfully after ${attempt} attempt(s)!`);
      logger.info(`Modified files: ${Array.from(allModifiedFiles).join(', ')}`);
      if (latestBackupId) {
        logger.info(`Backup snapshot created: ${latestBackupId}`);
      }
      return {
        status: 'success',
        passed: true,
        attempts: attempt,
        modifiedFiles: Array.from(allModifiedFiles),
        backupId: latestBackupId,
        usage: cumulativeUsage
      };
    }

    logger.warn(`Attempt ${attempt} failed. Collecting failure context for next repair attempt...`);
    currentFailures = {
      failedTests: postPatchTestResult.failedTests,
      assertionErrors: postPatchTestResult.assertionErrors,
      stackTraces: postPatchTestResult.stackTraces,
      rawOutput: postPatchTestResult.rawOutput
    };
  }

  logger.error(`Reached maximum repair attempts (${maxAttempts}) without passing all tests.`);
  logger.info(`You can restore files to pre-patch state using: npx ai-test-fixer rollback --id ${latestBackupId}`);

  return {
    status: 'max_attempts_reached',
    passed: false,
    attempts: maxAttempts,
    modifiedFiles: Array.from(allModifiedFiles),
    backupId: latestBackupId,
    usage: cumulativeUsage
  };
}
