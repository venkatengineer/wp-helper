import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  NodeTestAdapter,
  JestAdapter,
  VitestAdapter,
  MochaAdapter,
  CustomAdapter,
  resolveAdapter
} from '../src/adapters/index.js';
import { runTests } from '../src/test-runner.js';

describe('Test Framework Adapters and Runner', () => {
  it('builds appropriate execution commands for all adapters', () => {
    const nodeTest = new NodeTestAdapter();
    const cmd1 = nodeTest.buildCommand(['test/foo.test.js'], {});
    assert.equal(cmd1.command, 'node');
    assert.deepEqual(cmd1.args, ['--test', 'test/foo.test.js']);

    const jest = new JestAdapter();
    const cmd2 = jest.buildCommand(['test/foo.test.js'], {});
    assert.equal(cmd2.command, 'npx');
    assert.deepEqual(cmd2.args, ['jest', '--colors=false', '--runInBand', 'test/foo.test.js']);

    const vitest = new VitestAdapter();
    const cmd3 = vitest.buildCommand(['test/foo.test.js'], {});
    assert.equal(cmd3.command, 'npx');
    assert.deepEqual(cmd3.args, ['vitest', 'run', '--no-color', 'test/foo.test.js']);

    const mocha = new MochaAdapter();
    const cmd4 = mocha.buildCommand(['test/foo.test.js'], {});
    assert.equal(cmd4.command, 'npx');
    assert.deepEqual(cmd4.args, ['mocha', '--no-colors', 'test/foo.test.js']);

    const custom = new CustomAdapter('pnpm test --');
    const cmd5 = custom.buildCommand(['test/foo.test.js'], {});
    assert.equal(cmd5.command, 'pnpm');
    assert.deepEqual(cmd5.args, ['test', '--', 'test/foo.test.js']);
  });

  it('throws clear error when unknown test framework has no custom command', () => {
    const adapter = resolveAdapter('unknown', { fallbackToNodeTest: false });
    assert.throws(
      () => adapter.buildCommand(['test/foo.js'], {}),
      /Unknown test framework and no customTestCommand provided/
    );
  });

  it('parses node-test output correctly', () => {
    const adapter = new NodeTestAdapter();
    const stdout = `
      ▶ my test suite
        ✖ should calculate sum (3.2ms)
          AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
          + actual - expected
          + 5
          - 4
              at TestContext.<anonymous> (file:///test/sum.test.js:10:12)
              at Test.run (node:internal/test_runner/test:631:25)
    `;
    const parsed = adapter.parseOutput(stdout, '', 1);
    assert.equal(parsed.passed, false);
    assert.ok(parsed.failedTests.includes('should calculate sum'));
    assert.ok(parsed.assertionErrors.some(e => e.includes('ERR_ASSERTION')));
    assert.ok(parsed.stackTraces.length > 0);
  });

  it('parses jest failure output correctly', () => {
    const adapter = new JestAdapter();
    const stderr = `
      FAIL test/math.test.js
      ● Math › adds numbers
        Expected: 4
        Received: 5
          at Object.<anonymous> (test/math.test.js:12:20)
    `;
    const parsed = adapter.parseOutput('', stderr, 1);
    assert.equal(parsed.passed, false);
    assert.ok(parsed.failedTests.includes('Math › adds numbers'));
    assert.ok(parsed.assertionErrors.some(e => e.includes('Expected: 4')));
    assert.ok(parsed.stackTraces.length > 0);
  });

  it('parses vitest failure output correctly', () => {
    const adapter = new VitestAdapter();
    const stdout = `
      FAIL test/unit.test.ts > Unit Suite > performs calculation
      AssertionError: expected 5 to be 4
        at test/unit.test.ts:15:7
    `;
    const parsed = adapter.parseOutput(stdout, '', 1);
    assert.equal(parsed.passed, false);
    assert.ok(parsed.failedTests.some(t => t.includes('Unit Suite > performs calculation')));
    assert.ok(parsed.assertionErrors.some(e => e.includes('AssertionError')));
  });

  it('parses mocha failure output correctly', () => {
    const adapter = new MochaAdapter();
    const stdout = `
      1) String helper reverses string:
         AssertionError [ERR_ASSERTION]: Expected 'cba' to equal 'abc'
           at Context.<anonymous> (test/helper.test.js:8:14)
    `;
    const parsed = adapter.parseOutput(stdout, '', 1);
    assert.equal(parsed.passed, false);
    assert.ok(parsed.failedTests.includes('String helper reverses string'));
    assert.ok(parsed.assertionErrors.some(e => e.includes('AssertionError')));
  });

  it('terminates test runner when execution times out', async () => {
    // Run a command that sleeps longer than timeout
    const customAdapter = new CustomAdapter('node -e "setTimeout(() => {}, 5000)"');
    const result = await runTests(process.cwd(), {
      adapter: customAdapter,
      timeoutMs: 150
    });

    assert.equal(result.passed, false);
    assert.equal(result.timedOut, true);
    assert.equal(result.exitCode, 124);
  });

  it('supports cancellation via AbortSignal', async () => {
    const customAdapter = new CustomAdapter('node -e "setTimeout(() => {}, 5000)"');
    const controller = new AbortController();

    setTimeout(() => controller.abort(), 100);

    const result = await runTests(process.cwd(), {
      adapter: customAdapter,
      signal: controller.signal,
      timeoutMs: 5000
    });

    assert.equal(result.passed, false);
  });
});
