import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { validateSafePath, maskSecrets, isProhibitedFile } from '../src/utils/security.js';
import { atomicWriteFile, computeHash, computeFileHash } from '../src/utils/fs.js';

describe('Security and Safe Filesystem Utilities', () => {
  it('blocks path traversal outside repository root', () => {
    const rootDir = '/home/user/project';
    const check1 = validateSafePath(rootDir, '../outside.js');
    assert.equal(check1.safe, false);
    assert.match(check1.error, /Path traversal detected/);

    const check2 = validateSafePath(rootDir, 'src/../../etc/passwd');
    assert.equal(check2.safe, false);
    assert.match(check2.error, /Path traversal detected/);

    const check3 = validateSafePath(rootDir, '/etc/shadow');
    assert.equal(check3.safe, false);
  });

  it('blocks null byte injection', () => {
    const rootDir = '/home/user/project';
    const check = validateSafePath(rootDir, 'src/valid.js\0.evil');
    assert.equal(check.safe, false);
    assert.match(check.error, /null byte/);
  });

  it('detects prohibited sensitive files', () => {
    assert.ok(isProhibitedFile('.env'));
    assert.ok(isProhibitedFile('.env.local'));
    assert.ok(isProhibitedFile('.env.production'));
    assert.ok(isProhibitedFile('id_rsa'));
    assert.ok(isProhibitedFile('server.key'));
    assert.ok(isProhibitedFile('cert.pem'));
    assert.ok(isProhibitedFile('node_modules/foo'));
    assert.ok(isProhibitedFile('.git/config'));

    assert.equal(isProhibitedFile('src/calculator.js'), false);
    assert.equal(isProhibitedFile('test/calculator.test.js'), false);
  });

  it('blocks access to prohibited files in validateSafePath', () => {
    const rootDir = '/home/user/project';
    const check1 = validateSafePath(rootDir, '.env');
    assert.equal(check1.safe, false);
    assert.match(check1.error, /prohibited file/);

    const check2 = validateSafePath(rootDir, 'secrets/private.pem');
    assert.equal(check2.safe, false);
    assert.match(check2.error, /prohibited file/);
  });

  it('masks API keys, bearer tokens, and private keys in logs and output', () => {
    const secretApiKey = 'sk-abcdef1234567890abcdef1234567890';
    const maskedKey = maskSecrets(`Error with key: ${secretApiKey}`);
    assert.equal(maskedKey.includes('sk-abcdef1234567890'), false);
    assert.ok(maskedKey.includes('sk-[REDACTED_API_KEY]'));

    const bearerToken = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9';
    const maskedBearer = maskSecrets(`Authorization: ${bearerToken}`);
    assert.ok(maskedBearer.includes('Bearer [REDACTED_SECRET]'));

    const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEAz5\n-----END RSA PRIVATE KEY-----';
    const maskedPem = maskSecrets(`Key is:\n${pem}`);
    assert.ok(maskedPem.includes('[REDACTED_PRIVATE_KEY]'));
  });

  it('writes files atomically and computes consistent sha256 hashes', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sec-fs-'));
    try {
      const targetFile = path.join(tmpDir, 'sub/dir/output.txt');
      const content = 'Hello, safe atomic write!';

      atomicWriteFile(targetFile, content);
      assert.ok(fs.existsSync(targetFile));
      assert.equal(fs.readFileSync(targetFile, 'utf8'), content);

      const hash1 = computeHash(content);
      const fileHash = computeFileHash(targetFile);
      assert.equal(hash1, fileHash);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('detects symlinks escaping the repository root', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'symlink-sec-'));
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'outside-sec-'));
    try {
      fs.writeFileSync(path.join(outsideDir, 'secret.txt'), 'secret outside');
      try {
        fs.symlinkSync(path.join(outsideDir, 'secret.txt'), path.join(tmpDir, 'symlink-to-secret.txt'));
      } catch {
        return; // Skip if symlinks not supported
      }

      const check = validateSafePath(tmpDir, 'symlink-to-secret.txt');
      assert.equal(check.safe, false);
      assert.match(check.error, /Symlink escape detected/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  });
});
