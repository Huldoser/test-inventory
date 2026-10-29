#!/usr/bin/env node
import { run } from './cli.ts';

process.exitCode = await run(process.argv.slice(2), {
  stdout: process.stdout,
  stdin: process.stdin,
  stderr: process.stderr,
  cwd: process.cwd(),
});
