import { BaseAdapter } from './base.js';

export class NodeTestAdapter extends BaseAdapter {
  constructor() {
    super('node-test');
  }

  buildCommand(testFiles, projectInfo, options = {}) {
    const args = ['--test'];
    if (testFiles && testFiles.length > 0) {
      args.push(...testFiles);
    }
    return {
      command: 'node',
      args
    };
  }

  parseOutput(stdout, stderr, exitCode) {
    const passed = exitCode === 0;
    const combined = (stdout + '\n' + stderr).trim();
    const failedTests = [];
    const assertionErrors = [];
    const stackTraces = [];

    const lines = combined.split('\n');
    let inStack = false;
    let currentStack = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Match failed test markers in Node.js test runner:
      // Spec reporter: "✖ my test name (0.5ms)"
      // TAP reporter: "not ok 1 - my test name"
      const specFailMatch = line.match(/^\s*✖\s+(.+?)(?:\s+\([\d.]+m?s\))?$/);
      const tapFailMatch = line.match(/^not ok\s+\d+\s+-\s+(.+)$/);

      if (specFailMatch) {
        failedTests.push(specFailMatch[1].trim());
      } else if (tapFailMatch) {
        failedTests.push(tapFailMatch[1].trim());
      }

      // Match assertion errors
      if (line.includes('AssertionError') || line.includes('ERR_ASSERTION') || line.includes('error:')) {
        assertionErrors.push(line.trim());
      }

      // Match stack traces (standard or TAP YAML block)
      if (/^\s+at\s+/.test(line) || /^\s+stack:\s*\|-?/.test(line)) {
        inStack = true;
        currentStack.push(line.trim());
      } else if (inStack) {
        if (/^\s{4,}/.test(line)) {
          currentStack.push(line.trim());
        } else {
          if (currentStack.length > 0) {
            stackTraces.push(currentStack.join('\n'));
            currentStack = [];
          }
          inStack = false;
        }
      }
    }

    if (currentStack.length > 0) {
      stackTraces.push(currentStack.join('\n'));
    }

    // Fallback if specific parser didn't catch anything
    if (!passed && assertionErrors.length === 0 && stackTraces.length === 0) {
      const generic = this.extractGenericErrors(combined);
      assertionErrors.push(...generic.assertionErrors);
      stackTraces.push(...generic.stackTraces);
    }

    return {
      passed,
      exitCode,
      failedTests: [...new Set(failedTests)],
      assertionErrors: [...new Set(assertionErrors)],
      stackTraces,
      rawOutput: combined
    };
  }
}
