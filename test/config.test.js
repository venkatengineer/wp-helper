import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadConfig, validateConfig, DEFAULT_CONFIG } from '../src/config.js';

describe('Configuration Engine', () => {
  it('returns default config when no config file is present', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-test-'));
    try {
      const config = loadConfig(tmpDir);
      assert.equal(config.provider, 'openai');
      assert.equal(config.model, 'gpt-4.1-mini');
      assert.equal(config.maxAttempts, 3);
      assert.equal(config.approvalRequired, true);
      assert.ok(Array.isArray(config.testPatterns));
      assert.ok(Array.isArray(config.exclude));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('loads and merges ai-test-fixer.config.json', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-test-'));
    try {
      const customConfig = {
        provider: 'mock',
        model: 'custom-model',
        maxAttempts: 5,
        approvalRequired: false,
        testPatterns: ['**/*.spec.js']
      };
      fs.writeFileSync(path.join(tmpDir, 'ai-test-fixer.config.json'), JSON.stringify(customConfig));

      const config = loadConfig(tmpDir);
      assert.equal(config.provider, 'mock');
      assert.equal(config.model, 'custom-model');
      assert.equal(config.maxAttempts, 5);
      assert.equal(config.approvalRequired, false);
      assert.deepEqual(config.testPatterns, ['**/*.spec.js']);
      // Should retain default excludes
      assert.ok(config.exclude.includes('node_modules/**'));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('loads .ai-test-fixerrc.json alternative name', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-test-'));
    try {
      const customConfig = {
        model: 'rc-model',
        maxAttempts: 2
      };
      fs.writeFileSync(path.join(tmpDir, '.ai-test-fixerrc.json'), JSON.stringify(customConfig));

      const config = loadConfig(tmpDir);
      assert.equal(config.model, 'rc-model');
      assert.equal(config.maxAttempts, 2);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('validates invalid maxAttempts, provider, and testTimeoutMs', () => {
    const errors1 = validateConfig({ maxAttempts: -1 });
    assert.ok(errors1.some(e => e.includes('maxAttempts')));

    const errors2 = validateConfig({ maxAttempts: 'not-a-number' });
    assert.ok(errors2.some(e => e.includes('maxAttempts')));

    const errors3 = validateConfig({ testTimeoutMs: 100 });
    assert.ok(errors3.some(e => e.includes('testTimeoutMs')));

    const errors4 = validateConfig({ testPatterns: [] });
    assert.ok(errors4.some(e => e.includes('testPatterns')));

    const errors5 = validateConfig({ provider: 1234 });
    assert.ok(errors5.some(e => e.includes('provider')));
  });

  it('throws helpful error on malformed json config', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-test-'));
    try {
      fs.writeFileSync(path.join(tmpDir, 'ai-test-fixer.config.json'), '{ broken json ');
      assert.throws(() => loadConfig(tmpDir), /Failed to parse config file/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
