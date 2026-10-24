import { spawn } from 'node:child_process';
import { maskSecrets } from './utils/security.js';
import { resolveAdapter } from './adapters/index.js';
import { analyzeProject } from './project-analyzer.js';

/**
 * Execute tests using the resolved adapter
 *
 * @param {string} rootDir Repository root directory
 * @param {object} [options={}]
 * @param {string[]} [options.testFiles=[]] Specific test files to execute
 * @param {import('./adapters/base.js').BaseAdapter} [options.adapter] Optional explicit adapter
 * @param {string} [options.customTestCommand]
 * @param {number} [options.timeoutMs=120000]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<{
 *   passed: boolean,
 *   exitCode: number,
 *   failedTests: string[],
 *   assertionErrors: string[],
 *   stackTraces: string[],
 *   rawOutput: string,
 *   timedOut: boolean,
 *   durationMs: number,
 *   command: string
 * }>}
 */
export async function runTests(rootDir, options = {}) {
  const projectInfo = analyzeProject(rootDir);
  const timeoutMs = options.timeoutMs ?? 120000;
  const testFiles = options.testFiles ?? [];

  let adapter = options.adapter;
  if (!adapter) {
    let framework = projectInfo.testFramework;
    if (framework === 'unknown') {
      // Check if test files are runnable by node --test (e.g. *.test.js or test/*.js)
      // If no other framework detected and tests exist, check if user provided custom command
      if (options.customTestCommand) {
        framework = 'custom';
      } else {
        // Fallback to node-test if tests exist and node-compatible
        framework = 'node-test';
      }
    }
    adapter = resolveAdapter(framework, {
      customTestCommand: options.customTestCommand,
      fallbackToNodeTest: true
    });
  }

  const { command, args } = adapter.buildCommand(testFiles, projectInfo, {
    customTestCommand: options.customTestCommand
  });

  const startTime = Date.now();
  let timedOut = false;
  let stdoutData = '';
  let stderrData = '';

  return new Promise((resolve, reject) => {
    let childProcess;
    let timer = null;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
    };

    const childEnv = {
      ...process.env,
      NODE_ENV: 'test',
      CI: 'true',
      FORCE_COLOR: '0'
    };
    delete childEnv.NODE_TEST_CONTEXT;

    try {
      childProcess = spawn(command, args, {
        cwd: rootDir,
        env: childEnv,
        stdio: ['ignore', 'pipe', 'pipe']
      });
    } catch (err) {
      cleanup();
      return reject(new Error(`Failed to spawn test command "${command}": ${err.message}`));
    }

    if (options.signal) {
      if (options.signal.aborted) {
        try { childProcess.kill('SIGTERM'); } catch {}
        cleanup();
        return reject(new Error('Test execution aborted.'));
      }
      options.signal.addEventListener('abort', () => {
        try { childProcess.kill('SIGTERM'); } catch {}
      }, { once: true });
    }

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        try {
          childProcess.kill('SIGTERM');
          setTimeout(() => {
            try { childProcess.kill('SIGKILL'); } catch {}
          }, 2000);
        } catch {}
      }, timeoutMs);
    }

    childProcess.stdout.on('data', chunk => {
      stdoutData += chunk.toString();
    });

    childProcess.stderr.on('data', chunk => {
      stderrData += chunk.toString();
    });

    childProcess.on('error', err => {
      cleanup();
      reject(err);
    });

    childProcess.on('close', (code, signal) => {
      cleanup();
      const durationMs = Date.now() - startTime;
      const exitCode = timedOut ? 124 : (code ?? (signal ? 1 : 0));

      const parsed = adapter.parseOutput(stdoutData, stderrData, exitCode);

      resolve({
        passed: parsed.passed && !timedOut,
        exitCode,
        failedTests: parsed.failedTests,
        assertionErrors: parsed.assertionErrors,
        stackTraces: parsed.stackTraces,
        rawOutput: maskSecrets(parsed.rawOutput),
        timedOut,
        durationMs,
        command: `${command} ${args.join(' ')}`
      });
    });
  });
}
