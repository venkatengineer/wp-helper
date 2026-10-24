#!/usr/bin/env node

import { runCli } from '../src/cli.js';

runCli(process.argv.slice(2), process.cwd())
  .then(exitCode => {
    process.exit(exitCode);
  })
  .catch(err => {
    process.stderr.write(`Fatal error: ${err.message}\n`);
    if (process.env.DEBUG) {
      process.stderr.write(`${err.stack}\n`);
    }
    process.exit(1);
  });
