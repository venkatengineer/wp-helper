import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { scanRepository } from '../src/scanner.js';
import { discoverTests, matchesTestPattern } from '../src/test-discovery.js';

describe('Scanner and Test Discovery', () => {
  it('identifies various standard test patterns and extensions', () => {
    const patterns = ['**/*.test.js', '**/*.spec.ts', '**/test.js', '**/__tests__/**'];
    assert.ok(matchesTestPattern('test/foo.test.js', patterns));
    assert.ok(matchesTestPattern('src/foo.spec.ts', patterns));
    assert.ok(matchesTestPattern('test.js', patterns));
    assert.ok(matchesTestPattern('__tests__/unit.js', patterns));

    // Non-test files
    assert.equal(matchesTestPattern('test.txt', patterns), false);
    assert.equal(matchesTestPattern('README.md', patterns), false);
    assert.equal(matchesTestPattern('src/foo.js', patterns), false);
  });

  it('scans directory and discovers test files while excluding node_modules and dist', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-test-'));
    try {
      // Create valid test files
      fs.mkdirSync(path.join(tmpDir, 'test'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'test/math.test.js'), '// test');
      fs.writeFileSync(path.join(tmpDir, 'test/service.spec.ts'), '// test');

      fs.mkdirSync(path.join(tmpDir, '__tests__'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, '__tests__/app.test.jsx'), '// test');

      // Create excluded directories and files
      fs.mkdirSync(path.join(tmpDir, 'node_modules/pkg/test'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'node_modules/pkg/test/internal.test.js'), '// test');

      fs.mkdirSync(path.join(tmpDir, 'dist'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'dist/math.test.js'), '// test');

      fs.mkdirSync(path.join(tmpDir, 'coverage'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'coverage/lcov.info'), 'content');

      const discovered = discoverTests(tmpDir);
      const relPaths = discovered.map(d => d.relativePath).sort();

      assert.deepEqual(relPaths, [
        '__tests__/app.test.jsx',
        'test/math.test.js',
        'test/service.spec.ts'
      ]);

      const tsItem = discovered.find(d => d.relativePath === 'test/service.spec.ts');
      assert.ok(tsItem.isTypeScript);

      const jsItem = discovered.find(d => d.relativePath === 'test/math.test.js');
      assert.equal(jsItem.isTypeScript, false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('filters tests when specific filter pattern is provided', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-filter-'));
    try {
      fs.mkdirSync(path.join(tmpDir, 'test'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'test/math.test.js'), '// test');
      fs.writeFileSync(path.join(tmpDir, 'test/string.test.js'), '// test');

      const all = discoverTests(tmpDir);
      assert.equal(all.length, 2);

      const filtered = discoverTests(tmpDir, {}, 'test/math.test.js');
      assert.equal(filtered.length, 1);
      assert.equal(filtered[0].relativePath, 'test/math.test.js');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('handles symlink cycles safely without infinite recursion', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-symlink-'));
    try {
      fs.mkdirSync(path.join(tmpDir, 'subdir'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'subdir/foo.test.js'), '// test');

      // Create a recursive symlink: subdir/loop -> tmpDir
      try {
        fs.symlinkSync(tmpDir, path.join(tmpDir, 'subdir/loop'), 'dir');
      } catch (err) {
        // Skip symlink test if OS/environment prohibits symlink creation
        return;
      }

      const discovered = discoverTests(tmpDir);
      assert.equal(discovered.length, 1);
      assert.equal(discovered[0].relativePath, 'subdir/foo.test.js');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
