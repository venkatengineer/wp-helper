import { maskSecrets } from './utils/security.js';

export const LogLevel = {
  QUIET: 0,
  INFO: 1,
  VERBOSE: 2,
  DEBUG: 3
};

const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

export class Logger {
  /**
   * @param {object} [options]
   * @param {number} [options.level=LogLevel.INFO]
   * @param {boolean} [options.useColors=true]
   * @param {boolean} [options.silent=false]
   */
  constructor(options = {}) {
    this.level = options.level ?? LogLevel.INFO;
    this.useColors = options.useColors ?? (process.stdout.isTTY ?? false);
    this.silent = options.silent ?? false;
  }

  c(color, text) {
    return this.useColors ? `${ANSI[color] || ''}${text}${ANSI.reset}` : text;
  }

  log(text = '') {
    if (this.silent || this.level < LogLevel.INFO) return;
    process.stdout.write(maskSecrets(text) + '\n');
  }

  step(stepNumber, totalSteps, message) {
    if (this.silent || this.level < LogLevel.INFO) return;
    const badge = this.c('cyan', `[${stepNumber}/${totalSteps}]`);
    this.log(`${badge} ${this.c('bold', message)}`);
  }

  info(message) {
    if (this.silent || this.level < LogLevel.INFO) return;
    this.log(`${this.c('blue', 'ℹ')} ${message}`);
  }

  success(message) {
    if (this.silent || this.level < LogLevel.INFO) return;
    this.log(`${this.c('green', '✔')} ${this.c('bold', message)}`);
  }

  warn(message) {
    if (this.silent || this.level < LogLevel.INFO) return;
    process.stderr.write(maskSecrets(`${this.c('yellow', '⚠')} ${this.c('bold', message)}`) + '\n');
  }

  error(message, errorObj = null) {
    if (this.silent) return;
    process.stderr.write(maskSecrets(`${this.c('red', '✖')} ${this.c('bold', message)}`) + '\n');
    if (errorObj && this.level >= LogLevel.VERBOSE) {
      const errDetails = errorObj.stack || errorObj.message || String(errorObj);
      process.stderr.write(maskSecrets(this.c('dim', errDetails)) + '\n');
    }
  }

  debug(message) {
    if (this.silent || this.level < LogLevel.DEBUG) return;
    this.log(`${this.c('dim', 'DEBUG:')} ${this.c('dim', message)}`);
  }

  diff(diffText) {
    if (this.silent || this.level < LogLevel.INFO || !diffText) return;
    this.log(diffText);
  }
}

export const logger = new Logger();
