/**
 * Compute Longest Common Subsequence matrix for two arrays of lines
 * @param {string[]} oldLines
 * @param {string[]} newLines
 * @returns {number[][]}
 */
function computeLCS(oldLines, newLines) {
  const m = oldLines.length;
  const n = newLines.length;
  const lcs = Array.from({ length: m + 1 }, () => new Uint32Array(n + 1));

  for (let i = 0; i < m; i++) {
    for (let j = 0; j < n; j++) {
      if (oldLines[i] === newLines[j]) {
        lcs[i + 1][j + 1] = lcs[i][j] + 1;
      } else {
        lcs[i + 1][j + 1] = Math.max(lcs[i + 1][j], lcs[i][j + 1]);
      }
    }
  }
  return lcs;
}

/**
 * Generate diff operations (keep, delete, insert) from LCS matrix
 * @param {string[]} oldLines
 * @param {string[]} newLines
 * @returns {Array<{ type: 'keep'|'delete'|'insert', line: string, oldIndex?: number, newIndex?: number }>}
 */
function buildDiffOps(oldLines, newLines) {
  const lcs = computeLCS(oldLines, newLines);
  let i = oldLines.length;
  let j = newLines.length;
  const ops = [];

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      ops.unshift({ type: 'keep', line: oldLines[i - 1], oldIndex: i, newIndex: j });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || lcs[i][j - 1] >= lcs[i - 1][j])) {
      ops.unshift({ type: 'insert', line: newLines[j - 1], newIndex: j });
      j--;
    } else if (i > 0 && (j === 0 || lcs[i][j - 1] < lcs[i - 1][j])) {
      ops.unshift({ type: 'delete', line: oldLines[i - 1], oldIndex: i });
      i--;
    }
  }

  return ops;
}

/**
 * Generate unified diff string between oldContent and newContent
 *
 * @param {string} filePath File path for diff header
 * @param {string} oldContent Original file content (or empty string if new file)
 * @param {string} newContent New file content (or empty string if deleted)
 * @param {object} [options]
 * @param {number} [options.context=3] Number of context lines around changes
 * @param {boolean} [options.colorize=false] Whether to add ANSI colors
 * @returns {string} Unified diff string
 */
export function generateUnifiedDiff(filePath, oldContent, newContent, options = {}) {
  const context = options.context ?? 3;
  const colorize = options.colorize ?? false;

  const oldLines = oldContent.length > 0 ? oldContent.split('\n') : [];
  const newLines = newContent.length > 0 ? newContent.split('\n') : [];

  if (oldContent === newContent) {
    return '';
  }

  const ops = buildDiffOps(oldLines, newLines);

  // Group diff operations into hunks with context
  const hunks = [];
  let currentHunk = null;

  for (let idx = 0; idx < ops.length; idx++) {
    const op = ops[idx];
    if (op.type !== 'keep') {
      if (!currentHunk) {
        const start = Math.max(0, idx - context);
        currentHunk = {
          ops: ops.slice(start, idx),
          oldStart: start < idx && ops[start].oldIndex ? ops[start].oldIndex : (op.oldIndex || 1),
          newStart: start < idx && ops[start].newIndex ? ops[start].newIndex : (op.newIndex || 1),
          lastChangeIdx: idx
        };
      }
      currentHunk.ops.push(op);
      currentHunk.lastChangeIdx = idx;
    } else if (currentHunk) {
      if (idx - currentHunk.lastChangeIdx <= context) {
        currentHunk.ops.push(op);
      } else {
        hunks.push(currentHunk);
        currentHunk = null;
      }
    }
  }

  if (currentHunk) {
    hunks.push(currentHunk);
  }

  if (hunks.length === 0) {
    return '';
  }

  const ANSI = {
    red: '\x1b[31m',
    green: '\x1b[32m',
    cyan: '\x1b[36m',
    bold: '\x1b[1m',
    reset: '\x1b[0m'
  };

  const c = (color, text) => (colorize ? `${ANSI[color]}${text}${ANSI.reset}` : text);

  const headerOld = c('bold', `--- a/${filePath}`);
  const headerNew = c('bold', `+++ b/${filePath}`);
  const resultLines = [headerOld, headerNew];

  for (const hunk of hunks) {
    let oldCount = 0;
    let newCount = 0;

    for (const op of hunk.ops) {
      if (op.type === 'keep') {
        oldCount++;
        newCount++;
      } else if (op.type === 'delete') {
        oldCount++;
      } else if (op.type === 'insert') {
        newCount++;
      }
    }

    const hunkHeader = c('cyan', `@@ -${hunk.oldStart},${oldCount} +${hunk.newStart},${newCount} @@`);
    resultLines.push(hunkHeader);

    for (const op of hunk.ops) {
      if (op.type === 'keep') {
        resultLines.push(` ${op.line}`);
      } else if (op.type === 'delete') {
        resultLines.push(c('red', `-${op.line}`));
      } else if (op.type === 'insert') {
        resultLines.push(c('green', `+${op.line}`));
      }
    }
  }

  return resultLines.join('\n');
}
