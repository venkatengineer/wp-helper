import { execSync } from 'node:child_process';

/**
 * Check if the target directory is inside a Git repository
 * @param {string} rootDir
 * @returns {boolean}
 */
export function isGitRepository(rootDir) {
  try {
    const result = execSync('git rev-parse --is-inside-work-tree', {
      cwd: rootDir,
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8'
    });
    return result.trim() === 'true';
  } catch {
    return false;
  }
}

/**
 * Check if the Git working tree has uncommitted modifications or untracked files
 * @param {string} rootDir
 * @returns {{ clean: boolean, uncommittedFiles: string[], isGit: boolean }}
 */
export function getGitStatus(rootDir) {
  if (!isGitRepository(rootDir)) {
    return { clean: true, uncommittedFiles: [], isGit: false };
  }

  try {
    const output = execSync('git status --porcelain', {
      cwd: rootDir,
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8'
    });

    const lines = output
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0);

    const uncommittedFiles = lines.map(line => line.substring(3).trim());

    return {
      clean: lines.length === 0,
      uncommittedFiles,
      isGit: true
    };
  } catch {
    return { clean: true, uncommittedFiles: [], isGit: true };
  }
}
