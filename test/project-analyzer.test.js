import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  detectPackageManager,
  detectModuleSystem,
  detectWorkspaces,
  detectTestFramework,
  analyzeProject
} from '../src/project-analyzer.js';
import { extractImportPaths, resolveImportTarget, buildContext } from '../src/context-builder.js';

describe('Project Analyzer & Context Builder', () => {
  it('detects package manager based on lockfiles', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pkg-mgr-'));
    try {
      assert.equal(detectPackageManager(tmpDir), 'npm'); // default

      fs.writeFileSync(path.join(tmpDir, 'yarn.lock'), '');
      assert.equal(detectPackageManager(tmpDir), 'yarn');

      fs.writeFileSync(path.join(tmpDir, 'pnpm-lock.yaml'), '');
      assert.equal(detectPackageManager(tmpDir), 'pnpm');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('detects module systems (ESM vs CommonJS) and TypeScript', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'module-sys-'));
    try {
      // CommonJS default
      const cjs = detectModuleSystem(tmpDir, {});
      assert.equal(cjs.moduleType, 'commonjs');
      assert.equal(cjs.isTypeScript, false);

      // ESM
      const esm = detectModuleSystem(tmpDir, { type: 'module' });
      assert.equal(esm.moduleType, 'esm');

      // TypeScript
      fs.writeFileSync(path.join(tmpDir, 'tsconfig.json'), '{}');
      const ts = detectModuleSystem(tmpDir, { type: 'module' });
      assert.equal(ts.isTypeScript, true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('detects monorepos and workspaces', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-'));
    try {
      // npm workspaces
      const ws1 = detectWorkspaces(tmpDir, { workspaces: ['packages/*'] });
      assert.equal(ws1.isMonorepo, true);
      assert.equal(ws1.type, 'npm-or-yarn-workspaces');

      // pnpm workspaces
      fs.writeFileSync(path.join(tmpDir, 'pnpm-workspace.yaml'), 'packages:\n  - "apps/*"');
      const ws2 = detectWorkspaces(tmpDir, {});
      assert.equal(ws2.isMonorepo, true);
      assert.equal(ws2.type, 'pnpm-workspaces');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('detects test frameworks from configs and scripts', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-detect-'));
    try {
      // Jest via config
      fs.writeFileSync(path.join(tmpDir, 'jest.config.js'), 'module.exports = {};');
      assert.equal(detectTestFramework(tmpDir, {}).framework, 'jest');
      fs.unlinkSync(path.join(tmpDir, 'jest.config.js'));

      // Vitest via config
      fs.writeFileSync(path.join(tmpDir, 'vitest.config.ts'), 'export default {};');
      assert.equal(detectTestFramework(tmpDir, {}).framework, 'vitest');
      fs.unlinkSync(path.join(tmpDir, 'vitest.config.ts'));

      // Mocha via package deps
      const mochaDetected = detectTestFramework(tmpDir, {
        devDependencies: { mocha: '^10.0.0' }
      });
      assert.equal(mochaDetected.framework, 'mocha');

      // Node test runner via script
      const nodeTestDetected = detectTestFramework(tmpDir, {
        scripts: { test: 'node --test' }
      });
      assert.equal(nodeTestDetected.framework, 'node-test');

      // Unknown
      const unknownDetected = detectTestFramework(tmpDir, {
        scripts: { test: 'custom-runner' }
      });
      assert.equal(unknownDetected.framework, 'unknown');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('extracts imports and resolves missing module targets', () => {
    const code = `
      import { add, subtract } from '../src/calculator.js';
      import utils from './utils';
      const helper = require('./helper.cjs');
    `;
    const paths = extractImportPaths(code);
    assert.deepEqual(paths.sort(), ['../src/calculator.js', './helper.cjs', './utils']);
  });

  it('builds context payload identifying missing implementation targets', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-bld-'));
    try {
      fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
      fs.mkdirSync(path.join(tmpDir, 'test'), { recursive: true });

      const testContent = `
        import test from 'node:test';
        import assert from 'node:assert';
        import { add } from '../src/math.js';

        test('adds', () => {
          assert.equal(add(1, 2), 3);
        });
      `;
      fs.writeFileSync(path.join(tmpDir, 'test/math.test.js'), testContent);

      const ctx = buildContext(tmpDir, 'test/math.test.js');
      assert.equal(ctx.testFile.path, 'test/math.test.js');
      assert.equal(ctx.implementationFiles.length, 1);
      // Notice target file math.js does not exist yet!
      assert.equal(ctx.implementationFiles[0].path, 'src/math.js');
      assert.equal(ctx.implementationFiles[0].exists, false);
      assert.equal(ctx.implementationFiles[0].isTarget, true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
