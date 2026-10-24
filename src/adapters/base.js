/**
 * Base Test Runner Adapter
 */
export class BaseAdapter {
  constructor(name) {
    this.name = name;
  }

  /**
   * Build the execution command and arguments for the given test files
   * @param {string[]} testFiles Relative paths of test files
   * @param {object} projectInfo Project metadata
   * @param {object} [options]
   * @returns {{ command: string, args: string[] }}
   */
  buildCommand(testFiles, projectInfo, options = {}) {
    throw new Error(`buildCommand not implemented for ${this.name}`);
  }

  /**
   * Parse stdout, stderr, and exit code to extract structured failure info
   * @param {string} stdout
   * @param {string} stderr
   * @param {number} exitCode
   * @returns {{
   *   passed: boolean,
   *   exitCode: number,
   *   failedTests: string[],
   *   assertionErrors: string[],
   *   stackTraces: string[],
   *   rawOutput: string
   * }}
   */
  parseOutput(stdout, stderr, exitCode) {
    const passed = exitCode === 0;
    const rawOutput = (stdout + '\n' + stderr).trim();

    return {
      passed,
      exitCode,
      failedTests: [],
      assertionErrors: [],
      stackTraces: [],
      rawOutput
    };
  }

  /**
   * Extract error messages and stack traces from generic output
   * @protected
   */
  extractGenericErrors(text) {
    const assertionErrors = [];
    const stackTraces = [];
    const lines = text.split('\n');
    let capturingStack = false;
    let currentStack = [];

    for (const line of lines) {
      if (line.includes('AssertionError') || line.includes('Error:') || line.includes('Expected') || line.includes('Received')) {
        assertionErrors.push(line.trim());
      }
      if (/^\s+at\s+/.test(line)) {
        currentStack.push(line.trim());
        capturingStack = true;
      } else if (capturingStack) {
        if (currentStack.length > 0) {
          stackTraces.push(currentStack.join('\n'));
          currentStack = [];
        }
        capturingStack = false;
      }
    }

    if (currentStack.length > 0) {
      stackTraces.push(currentStack.join('\n'));
    }

    return { assertionErrors, stackTraces };
  }
}
