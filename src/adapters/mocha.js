import { BaseAdapter } from './base.js';

export class MochaAdapter extends BaseAdapter {
  constructor() {
    super('mocha');
  }

  buildCommand(testFiles, projectInfo, options = {}) {
    const args = ['mocha', '--no-colors'];
    if (testFiles && testFiles.length > 0) {
      args.push(...testFiles);
    }
    return {
      command: 'npx',
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

      // Mocha failure marker: "  1) Suite Name test description:"
      const failMatch = line.match(/^\s*\d+\)\s+(.+?):?$/);
      if (failMatch) {
        failedTests.push(failMatch[1].trim());
      }

      if (line.includes('AssertionError') || line.includes('expected') || line.includes('Error:')) {
        assertionErrors.push(line.trim());
      }

      if (/^\s+at\s+/.test(line)) {
        inStack = true;
        currentStack.push(line.trim());
      } else if (inStack) {
        if (currentStack.length > 0) {
          stackTraces.push(currentStack.join('\n'));
          currentStack = [];
        }
        inStack = false;
      }
    }

    if (currentStack.length > 0) {
      stackTraces.push(currentStack.join('\n'));
    }

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
