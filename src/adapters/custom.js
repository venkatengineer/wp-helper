import { BaseAdapter } from './base.js';

export class CustomAdapter extends BaseAdapter {
  /**
   * @param {string|null} customCommand
   */
  constructor(customCommand = null) {
    super('custom');
    this.customCommand = customCommand;
  }

  buildCommand(testFiles, projectInfo, options = {}) {
    const rawCmd = options.customTestCommand || this.customCommand;
    if (!rawCmd) {
      throw new Error(
        'Unknown test framework and no customTestCommand provided. ' +
        'Please define "customTestCommand" in your ai-test-fixer.config.json or package.json scripts.'
      );
    }

    const parts = rawCmd.trim().split(/\s+/);
    const command = parts[0];
    const args = parts.slice(1);

    if (testFiles && testFiles.length > 0) {
      args.push(...testFiles);
    }

    return {
      command,
      args
    };
  }

  parseOutput(stdout, stderr, exitCode) {
    const passed = exitCode === 0;
    const combined = (stdout + '\n' + stderr).trim();
    const generic = this.extractGenericErrors(combined);

    return {
      passed,
      exitCode,
      failedTests: [],
      assertionErrors: generic.assertionErrors,
      stackTraces: generic.stackTraces,
      rawOutput: combined
    };
  }
}
