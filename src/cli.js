import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import readline from 'node:readline/promises';
import { loadConfig } from './config.js';
import { discoverTests } from './test-discovery.js';
import { analyzeProject } from './project-analyzer.js';
import { runTests } from './test-runner.js';
import { buildContext } from './context-builder.js';
import { createProvider } from './provider-manager.js';
import { validatePatch } from './patch-validator.js';
import { previewDiffs } from './patcher.js';
import { BackupManager } from './backup-manager.js';
import { runRepairLoop } from './repair-loop.js';
import { Logger, LogLevel } from './logger.js';

const VERSION = '1.0.0';

const HELP_TEXT = `ai-test-fixer v${VERSION}
AI-Powered Test-Driven Code Generation & Automated Test Repair Toolkit

USAGE:
  npx ai-test-fixer [command] [options]

COMMANDS:
  fix                  Discover tests, generate patches, and repair code (default command)
  scan                 Discover and list test files and project metadata without making changes
  plan                 Generate a proposed repair plan and unified diff without writing to disk
  check                Run existing test suite directly without invoking AI
  rollback             Restore files from a previous backup snapshot

OPTIONS:
  --apply, -y, --yes   Apply validated changes automatically without interactive prompt
  --test <path>        Target a specific test file or pattern (e.g., "test/calculator.test.js")
  --max-attempts <n>   Maximum number of repair iterations (default: 3)
  --allow-dirty        Allow running on a Git repository with uncommitted changes
  --json               Output machine-readable JSON (supported by scan, plan, check)
  --id <backup-id>     Specific backup ID for rollback
  --list               List available backups (with rollback command)
  --verbose            Display detailed debug info and full stack traces
  --quiet              Suppress non-essential output
  --help, -h           Show this help message
  --version, -v        Show version number

EXAMPLES:
  npx ai-test-fixer scan
  npx ai-test-fixer check
  npx ai-test-fixer plan --test "test/calculator.test.js"
  npx ai-test-fixer fix --test "test/calculator.test.js"
  npx ai-test-fixer fix --apply
  npx ai-test-fixer rollback
`;

/**
 * CLI Entry point
 * @param {string[]} argv Process arguments
 * @param {string} [cwd=process.cwd()] Working directory
 * @returns {Promise<number>} Exit code
 */
export async function runCli(argv = process.argv.slice(2), cwd = process.cwd()) {
  const optionsConfig = {
    help: { type: 'boolean', short: 'h' },
    version: { type: 'boolean', short: 'v' },
    apply: { type: 'boolean' },
    yes: { type: 'boolean', short: 'y' },
    test: { type: 'string' },
    'max-attempts': { type: 'string' },
    'allow-dirty': { type: 'boolean' },
    json: { type: 'boolean' },
    id: { type: 'string' },
    list: { type: 'boolean' },
    verbose: { type: 'boolean' },
    quiet: { type: 'boolean' },
    force: { type: 'boolean', short: 'f' }
  };

  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      options: optionsConfig,
      allowPositionals: true
    });
  } catch (err) {
    process.stderr.write(`Error: ${err.message}\nRun "ai-test-fixer --help" for usage information.\n`);
    return 2;
  }

  const { values, positionals } = parsed;

  if (values.help) {
    process.stdout.write(HELP_TEXT);
    return 0;
  }

  if (values.version) {
    process.stdout.write(`ai-test-fixer v${VERSION}\n`);
    return 0;
  }

  const logLevel = values.quiet ? LogLevel.QUIET : (values.verbose ? LogLevel.VERBOSE : LogLevel.INFO);
  const logger = new Logger({
    level: logLevel,
    useColors: process.stdout.isTTY ?? false,
    silent: values.json ?? false
  });

  const command = positionals[0] || 'fix';

  // Load project configuration
  let config;
  try {
    const overrides = {};
    if (values['max-attempts']) {
      const parsedAttempts = parseInt(values['max-attempts'], 10);
      if (isNaN(parsedAttempts) || parsedAttempts < 1) {
        throw new Error('--max-attempts must be a positive integer.');
      }
      overrides.maxAttempts = parsedAttempts;
    }
    if (values['allow-dirty']) {
      overrides.allowDirty = true;
    }
    config = loadConfig(cwd, overrides);
  } catch (err) {
    process.stderr.write(`Configuration error: ${err.message}\n`);
    return 2;
  }

  // Handle COMMAND: scan
  if (command === 'scan') {
    const projectInfo = analyzeProject(cwd);
    const tests = discoverTests(cwd, config, values.test);

    if (values.json) {
      process.stdout.write(JSON.stringify({
        project: {
          packageManager: projectInfo.packageManager,
          moduleType: projectInfo.moduleType,
          isTypeScript: projectInfo.isTypeScript,
          testFramework: projectInfo.testFramework,
          isMonorepo: projectInfo.isMonorepo
        },
        testCount: tests.length,
        tests: tests.map(t => ({
          path: t.relativePath,
          size: t.size,
          isTypeScript: t.isTypeScript
        }))
      }, null, 2) + '\n');
      return 0;
    }

    logger.info(`Project Environment:`);
    logger.log(`  Package Manager: ${projectInfo.packageManager}`);
    logger.log(`  Module System:   ${projectInfo.moduleType}`);
    logger.log(`  TypeScript:      ${projectInfo.isTypeScript ? 'Yes' : 'No'}`);
    logger.log(`  Test Framework:  ${projectInfo.testFramework}`);
    logger.log(`  Monorepo:        ${projectInfo.isMonorepo ? 'Yes' : 'No'}`);
    logger.log(`\nDiscovered Tests (${tests.length}):`);
    for (const test of tests) {
      logger.log(`  - ${test.relativePath} (${test.size} bytes)`);
    }
    return 0;
  }

  // Handle COMMAND: check
  if (command === 'check') {
    logger.info('Executing project test suite...');
    const discovered = discoverTests(cwd, config, values.test);
    const testFilePaths = discovered.map(t => t.relativePath);

    const result = await runTests(cwd, {
      testFiles: testFilePaths,
      customTestCommand: config.customTestCommand,
      timeoutMs: config.testTimeoutMs
    });

    if (values.json) {
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      return result.passed ? 0 : 1;
    }

    if (result.passed) {
      logger.success(`Tests passed! (duration: ${result.durationMs}ms)`);
      return 0;
    } else {
      logger.error(`Tests failed with exit code ${result.exitCode}.`);
      if (result.rawOutput) {
        logger.log(result.rawOutput);
      }
      return 1;
    }
  }

  // Handle COMMAND: rollback
  if (command === 'rollback') {
    const backupManager = new BackupManager(cwd);

    if (values.list) {
      const backups = backupManager.listBackups();
      if (backups.length === 0) {
        logger.info('No backups found.');
        return 0;
      }
      logger.info(`Available Backups (${backups.length}):`);
      for (const b of backups) {
        logger.log(`  - ${b.id} | ${b.createdAt} | ${b.reason} (${b.fileCount} files)`);
      }
      return 0;
    }

    try {
      const rollbackResult = backupManager.rollback(values.id);
      logger.success(`Successfully rolled back to backup snapshot "${rollbackResult.backupId}".`);
      logger.info(`Restored files:\n  - ${rollbackResult.restoredFiles.join('\n  - ')}`);
      return 0;
    } catch (err) {
      logger.error(`Rollback failed: ${err.message}`);
      return 1;
    }
  }

  // Handle COMMAND: plan
  if (command === 'plan') {
    logger.info('Analyzing project and generating repair plan (dry-run mode, no changes will be applied)...');
    const discovered = discoverTests(cwd, config, values.test);
    if (discovered.length === 0) {
      logger.error('No tests discovered.');
      return 1;
    }

    const testFilePaths = discovered.map(t => t.relativePath);
    const targetTest = testFilePaths[0];

    // Check baseline
    logger.info(`Checking baseline for "${targetTest}"...`);
    const baseline = await runTests(cwd, {
      testFiles: testFilePaths,
      customTestCommand: config.customTestCommand,
      timeoutMs: config.testTimeoutMs
    });

    if (baseline.passed) {
      logger.success('All tests already pass! No repair plan needed.');
      return 0;
    }

    // Context & AI query
    const context = buildContext(cwd, targetTest, {
      testFailures: {
        failedTests: baseline.failedTests,
        assertionErrors: baseline.assertionErrors,
        stackTraces: baseline.stackTraces,
        rawOutput: baseline.rawOutput
      },
      maxFileBytes: config.maxFileBytes,
      maxContextTokens: config.maxContextTokens
    });

    const provider = createProvider(config.provider, config);
    let aiResponse;
    try {
      aiResponse = await provider.generateEdits(context);
    } catch (err) {
      logger.error(`AI provider error: ${err.message}`);
      return 1;
    }

    const validation = validatePatch(cwd, aiResponse, {
      testPatterns: config.testPatterns,
      knownTestFiles: testFilePaths
    });

    if (!validation.valid) {
      logger.error(`Proposed plan failed validation:\n  - ${validation.errors.join('\n  - ')}`);
      return 1;
    }

    const diffs = previewDiffs(cwd, validation.validatedEdits, { colorize: logger.useColors });

    if (values.json) {
      process.stdout.write(JSON.stringify({
        summary: validation.summary,
        edits: validation.validatedEdits,
        diffs: diffs.map(d => ({ path: d.path, isNew: d.isNew, diff: d.diff })),
        questions: validation.questions
      }, null, 2) + '\n');
      return 0;
    }

    logger.info(`Proposed Repair Plan: ${validation.summary}`);
    for (const diff of diffs) {
      logger.log(`\nDiff for ${diff.path} (${diff.isNew ? 'New File' : 'Existing File'}):`);
      logger.diff(diff.diff);
    }

    if (validation.questions.length > 0) {
      logger.warn(`AI Questions:\n  - ${validation.questions.join('\n  - ')}`);
    }

    logger.info('\nPlan generated successfully without modifying files. Run "npx ai-test-fixer fix" to apply.');
    return 0;
  }

  // Handle COMMAND: fix
  if (command === 'fix') {
    const applyDirectly = Boolean(values.apply || values.yes || !config.approvalRequired);

    // Interactive approval callback when not --apply
    const approvalCallback = async ({ summary, diffs, attempt }) => {
      if (!process.stdin.isTTY) {
        logger.warn('Non-interactive terminal detected without --apply flag. Pass --apply to apply automatically.');
        return false;
      }

      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      try {
        const answer = await rl.question('\nApply proposed changes to disk? [y/N]: ');
        return answer.trim().toLowerCase() === 'y' || answer.trim().toLowerCase() === 'yes';
      } finally {
        rl.close();
      }
    };

    const result = await runRepairLoop(cwd, {
      config,
      logger,
      testFilter: values.test,
      maxAttempts: values['max-attempts'] ? parseInt(values['max-attempts'], 10) : config.maxAttempts,
      applyDirectly,
      approvalCallback,
      allowDirty: values['allow-dirty']
    });

    if (result.status === 'success' || result.status === 'already_passing') {
      return 0;
    }

    if (result.status === 'cancelled_by_user') {
      return 130;
    }

    return 1;
  }

  process.stderr.write(`Unknown command "${command}". Run "ai-test-fixer --help" for available commands.\n`);
  return 2;
}
