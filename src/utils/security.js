import path from 'node:path';
import fs from 'node:fs';

/**
 * Common prohibited patterns: secrets, git internals, node_modules, private keys
 */
const PROHIBITED_FILE_PATTERNS = [
  /^\.env($|\..+)/i,                 // .env, .env.local, .env.production, etc.
  /\.pem$/i,
  /\.key$/i,
  /id_rsa/i,
  /id_ed25519/i,
  /id_ecdsa/i,
  /\.pfx$/i,
  /\.p12$/i,
  /credentials\.json$/i,
  /service-account.*\.json$/i,
  /\.git\b/i,
  /node_modules\b/i
];

/**
 * Secret tokens masking patterns
 */
const SECRET_REGEX_PATTERNS = [
  /sk-[a-zA-Z0-9_-]{20,}/g,                        // OpenAI API keys
  /Bearer\s+[a-zA-Z0-9_.-\/+=]{16,}/gi,            // Authorization bearer tokens
  /(?:api[_-]?key|secret|password|token|auth)["'\s:=]+[a-zA-Z0-9_\-\/+=.]{8,}/gi,
  /-----BEGIN [A-Z ]+ PRIVATE KEY-----[\s\S]+?-----END [A-Z ]+ PRIVATE KEY-----/g,
  /ghp_[a-zA-Z0-9]{36}/g,                          // GitHub tokens
  /xox[baprs]-[0-9a-zA-Z]{10,48}/g                 // Slack tokens
];

/**
 * Mask sensitive secrets in any string (logs, AI requests, test output)
 * @param {string} text
 * @returns {string}
 */
export function maskSecrets(text) {
  if (typeof text !== 'string') return text;
  let result = text;
  for (const regex of SECRET_REGEX_PATTERNS) {
    result = result.replace(regex, (match) => {
      if (match.startsWith('Bearer ')) {
        return 'Bearer [REDACTED_SECRET]';
      }
      if (match.startsWith('sk-')) {
        return 'sk-[REDACTED_API_KEY]';
      }
      if (match.startsWith('-----BEGIN')) {
        return '[REDACTED_PRIVATE_KEY]';
      }
      return '[REDACTED_SECRET]';
    });
  }
  return result;
}

/**
 * Check if a relative or absolute file path targets a prohibited sensitive file
 * @param {string} filePath
 * @returns {boolean}
 */
export function isProhibitedFile(filePath) {
  if (!filePath) return true;
  const basename = path.basename(filePath);
  const normalized = filePath.replace(/\\/g, '/');

  for (const pattern of PROHIBITED_FILE_PATTERNS) {
    if (pattern.test(basename) || pattern.test(normalized)) {
      return true;
    }
  }
  return false;
}

/**
 * Validates that targetPath is securely inside rootDir, prevents path traversal,
 * null byte injection, and symlink escapes.
 *
 * @param {string} rootDir Repository root directory
 * @param {string} targetPath Relative or absolute target path
 * @returns {{ safe: boolean, resolvedPath: string, relativePath: string, error?: string }}
 */
export function validateSafePath(rootDir, targetPath) {
  if (!targetPath || typeof targetPath !== 'string') {
    return { safe: false, resolvedPath: '', relativePath: '', error: 'Target path must be a non-empty string.' };
  }

  // Null byte injection check
  if (targetPath.includes('\0')) {
    return { safe: false, resolvedPath: '', relativePath: '', error: 'Path contains invalid null byte.' };
  }

  const resolvedRoot = path.resolve(rootDir);
  const resolvedTarget = path.isAbsolute(targetPath)
    ? path.resolve(targetPath)
    : path.resolve(resolvedRoot, targetPath);

  // Traversal check: resolved target must be within resolvedRoot
  const relative = path.relative(resolvedRoot, resolvedTarget);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return {
      safe: false,
      resolvedPath: resolvedTarget,
      relativePath: relative,
      error: `Path traversal detected: "${targetPath}" escapes repository root "${rootDir}".`
    };
  }

  // Prohibited file check
  if (isProhibitedFile(relative)) {
    return {
      safe: false,
      resolvedPath: resolvedTarget,
      relativePath: relative,
      error: `Access to prohibited file or directory is blocked: "${relative}".`
    };
  }

  // Symlink escape check: if path or any existing ancestor is a symlink, verify realpath
  try {
    let checkPath = resolvedTarget;
    while (!fs.existsSync(checkPath)) {
      const parent = path.dirname(checkPath);
      if (parent === checkPath) break;
      checkPath = parent;
    }

    if (fs.existsSync(checkPath) && fs.existsSync(resolvedRoot)) {
      const realCheckPath = fs.realpathSync(checkPath);
      const realRoot = fs.realpathSync(resolvedRoot);
      const realRel = path.relative(realRoot, realCheckPath);
      if (realRel.startsWith('..') || path.isAbsolute(realRel)) {
        return {
          safe: false,
          resolvedPath: resolvedTarget,
          relativePath: relative,
          error: `Symlink escape detected: "${targetPath}" resolves to outside repository root.`
        };
      }
    }
  } catch (err) {
    return {
      safe: false,
      resolvedPath: resolvedTarget,
      relativePath: relative,
      error: `Failed to verify symlink safety: ${err.message}`
    };
  }

  // Normalize relative path with forward slashes for cross-platform consistency
  const normalizedRel = relative.replace(/\\/g, '/');

  return {
    safe: true,
    resolvedPath: resolvedTarget,
    relativePath: normalizedRel
  };
}
