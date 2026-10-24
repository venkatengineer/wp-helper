import { NodeTestAdapter } from './node-test.js';
import { JestAdapter } from './jest.js';
import { VitestAdapter } from './vitest.js';
import { MochaAdapter } from './mocha.js';
import { CustomAdapter } from './custom.js';

export {
  NodeTestAdapter,
  JestAdapter,
  VitestAdapter,
  MochaAdapter,
  CustomAdapter
};

/**
 * Resolves the appropriate test framework adapter
 * @param {string} framework
 * @param {object} [options={}]
 * @returns {import('./base.js').BaseAdapter}
 */
export function resolveAdapter(framework, options = {}) {
  if (options.customTestCommand) {
    return new CustomAdapter(options.customTestCommand);
  }

  switch (framework) {
    case 'node-test':
      return new NodeTestAdapter();
    case 'jest':
      return new JestAdapter();
    case 'vitest':
      return new VitestAdapter();
    case 'mocha':
      return new MochaAdapter();
    case 'custom':
      return new CustomAdapter(options.customTestCommand);
    default:
      if (options.fallbackToNodeTest) {
        return new NodeTestAdapter();
      }
      return new CustomAdapter(null);
  }
}
