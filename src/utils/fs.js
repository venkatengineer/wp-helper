import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/**
 * Computes SHA-256 hash of string or buffer
 * @param {string|Buffer} content
 * @returns {string}
 */
export function computeHash(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Computes SHA-256 hash of an existing file
 * @param {string} filePath
 * @returns {string|null}
 */
export function computeFileHash(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const content = fs.readFileSync(filePath);
    return computeHash(content);
  } catch {
    return null;
  }
}

/**
 * Reads a file up to maxBytes. Throws if file exceeds maxBytes.
 * @param {string} filePath
 * @param {number} maxBytes
 * @returns {string}
 */
export function safeReadFile(filePath, maxBytes = 100000) {
  const stat = fs.statSync(filePath);
  if (stat.size > maxBytes) {
    throw new Error(`File "${filePath}" (${stat.size} bytes) exceeds configured limit (${maxBytes} bytes).`);
  }
  return fs.readFileSync(filePath, 'utf8');
}

/**
 * Safely writes a file atomically via temporary file and rename
 * @param {string} filePath
 * @param {string} content
 */
export function atomicWriteFile(filePath, content) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const tempPath = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
  try {
    fs.writeFileSync(tempPath, content, 'utf8');
    fs.renameSync(tempPath, filePath);
  } catch (err) {
    try {
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
    } catch {
      // ignore cleanup error
    }
    throw err;
  }
}

/**
 * Safely removes a file if it exists
 * @param {string} filePath
 */
export function safeDeleteFile(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (err) {
    if (err.code !== 'ENOENT') {
      throw err;
    }
  }
}

/**
 * Match a glob pattern against a relative path.
 * Supports recursive wildcard, filename wildcard, and single char.
 * @param {string} pattern Glob pattern
 * @param {string} testPath Relative path with forward slashes
 * @returns {boolean}
 */
export function matchGlob(pattern, testPath) {
  const normPattern = pattern.replace(/\\/g, '/');
  const normPath = testPath.replace(/\\/g, '/');

  // Convert glob pattern to regular expression
  let regexStr = '^';
  let i = 0;
  const len = normPattern.length;

  while (i < len) {
    const c = normPattern[i];
    if (c === '*' && normPattern[i + 1] === '*') {
      // `**` pattern
      if (normPattern[i + 2] === '/') {
        regexStr += '(?:.+/)?';
        i += 3;
      } else {
        regexStr += '.*';
        i += 2;
      }
    } else if (c === '*') {
      regexStr += '[^/]*';
      i += 1;
    } else if (c === '?') {
      regexStr += '[^/]';
      i += 1;
    } else if (['.', '(', ')', '+', '|', '^', '$', '[', ']', '{', '}', '\\'].includes(c)) {
      regexStr += '\\' + c;
      i += 1;
    } else {
      regexStr += c;
      i += 1;
    }
  }
  regexStr += '$';

  try {
    const regex = new RegExp(regexStr);
    return regex.test(normPath);
  } catch {
    return false;
  }
}
