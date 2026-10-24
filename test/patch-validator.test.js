import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { validatePatch } from '../src/patch-validator.js';

describe('Patch Validator', () => {
  let rootDir;

  before(() => {
    rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'patch-val-'));
  });

  after(() => {
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it('validates a valid patch response adhering to schema', () => {
    const validResponse = {
      summary: 'Implement addition function',
      edits: [
        {
          path: 'src/calculator.js',
          operation: 'replace',
          content: 'export const add = (a, b) => a + b;',
          reason: 'Fulfills test requirements'
        }
      ],
      questions: []
    };

    const result = validatePatch(rootDir, validResponse, {
      knownTestFiles: ['test/calculator.test.js']
    });

    assert.equal(result.valid, true);
    assert.equal(result.errors.length, 0);
    assert.equal(result.summary, 'Implement addition function');
    assert.equal(result.validatedEdits.length, 1);
    assert.equal(result.validatedEdits[0].path, 'src/calculator.js');
    assert.equal(result.validatedEdits[0].operation, 'replace');
  });

  it('rejects malformed responses (null, string, missing summary or edits)', () => {
    const r1 = validatePatch(rootDir, null);
    assert.equal(r1.valid, false);

    const r2 = validatePatch(rootDir, { edits: [] });
    assert.equal(r2.valid, false);
    assert.ok(r2.errors.some(e => e.includes('summary')));

    const r3 = validatePatch(rootDir, { summary: 'test', edits: 'invalid' });
    assert.equal(r3.valid, false);
    assert.ok(r3.errors.some(e => e.includes('must be an array')));
  });

  it('STRICT SAFETY: rejects any attempt to modify or weaken test files', () => {
    const maliciousResponse = {
      summary: 'Make test pass by commenting out assertion',
      edits: [
        {
          path: 'test/calculator.test.js',
          operation: 'replace',
          content: '// commented out assertions',
          reason: 'Make test pass'
        }
      ]
    };

    const result = validatePatch(rootDir, maliciousResponse, {
      knownTestFiles: ['test/calculator.test.js']
    });

    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('Safety violation - proposed edit targets test file')));
  });

  it('rejects unsafe paths with directory traversal or prohibited files', () => {
    const traversalResponse = {
      summary: 'Write outside root',
      edits: [
        {
          path: '../../etc/cron.d/hack',
          operation: 'create',
          content: 'malicious',
          reason: 'malicious'
        }
      ]
    };
    const r1 = validatePatch(rootDir, traversalResponse);
    assert.equal(r1.valid, false);
    assert.ok(r1.errors.some(e => e.includes('Path traversal detected')));

    const envResponse = {
      summary: 'Overwrite env',
      edits: [
        {
          path: '.env',
          operation: 'replace',
          content: 'KEY=val',
          reason: 'env write'
        }
      ]
    };
    const r2 = validatePatch(rootDir, envResponse);
    assert.equal(r2.valid, false);
    assert.ok(r2.errors.some(e => e.includes('prohibited')));
  });

  it('rejects unsupported edit operations', () => {
    const invalidOpResponse = {
      summary: 'Run shell command',
      edits: [
        {
          path: 'src/foo.js',
          operation: 'execute_shell',
          content: 'rm -rf /',
          reason: 'malicious'
        }
      ]
    };

    const result = validatePatch(rootDir, invalidOpResponse);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('Unsupported operation')));
  });
});
