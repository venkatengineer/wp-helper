import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runCli } from '../src/cli.js';

describe('CLI Commands & Flags', () => {
  it('handles --help and --version', async () => {
    let output = '';
    const origWrite = process.stdout.write;
    process.stdout.write = (chunk) => {
      output += chunk;
      return true;
    };

    try {
      const exitHelp = await runCli(['--help']);
      assert.equal(exitHelp, 0);
      assert.ok(output.includes('ai-test-fixer v'));
      assert.ok(output.includes('USAGE:'));

      output = '';
      const exitVersion = await runCli(['--version']);
      assert.equal(exitVersion, 0);
      assert.ok(output.includes('1.0.0'));
    } finally {
      process.stdout.write = origWrite;
    }
  });

  it('runs "scan" command and outputs valid json with --json', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-scan-'));
    try {
      fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'scan-proj', type: 'module' }));
      fs.mkdirSync(path.join(tmpDir, 'test'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'test/math.test.js'), '// test content');

      let captured = '';
      const origWrite = process.stdout.write;
      process.stdout.write = (chunk) => {
        captured += chunk;
        return true;
      };

      try {
        const exitCode = await runCli(['scan', '--json'], tmpDir);
        assert.equal(exitCode, 0);
        const parsed = JSON.parse(captured);
        assert.equal(parsed.testCount, 1);
        assert.equal(parsed.tests[0].path, 'test/math.test.js');
        assert.equal(parsed.project.moduleType, 'esm');
      } finally {
        process.stdout.write = origWrite;
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('runs "check" command and returns 0 when tests pass, 1 when they fail', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-check-'));
    try {
      fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ type: 'module' }));
      fs.mkdirSync(path.join(tmpDir, 'test'), { recursive: true });

      // Passing test
      fs.writeFileSync(
        path.join(tmpDir, 'test/pass.test.js'),
        "import test from 'node:test'; import assert from 'node:assert'; test('ok', () => assert.ok(true));\n"
      );

      const passExit = await runCli(['check', '--test', 'test/pass.test.js'], tmpDir);
      assert.equal(passExit, 0);

      // Failing test
      fs.writeFileSync(
        path.join(tmpDir, 'test/fail.test.js'),
        "import test from 'node:test'; import assert from 'node:assert'; test('fail', () => assert.fail('broken'));\n"
      );

      const failExit = await runCli(['check', '--test', 'test/fail.test.js'], tmpDir);
      assert.equal(failExit, 1);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('runs "rollback --list" without error', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-rb-'));
    try {
      const exitCode = await runCli(['rollback', '--list'], tmpDir);
      assert.equal(exitCode, 0);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('returns exit code 2 for invalid options', async () => {
    const exitCode = await runCli(['--unknown-bad-flag-xyz']);
    assert.equal(exitCode, 2);
  });
});
