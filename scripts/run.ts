import { execFileSync } from 'node:child_process';

/** Runs a command and returns its standard output. npm and npx need a shell on Windows. */
export function run(command: string, args: string[], cwd: string): string {
  return execFileSync(command, args, {
    cwd,
    encoding: 'utf8',
    shell: process.platform === 'win32' && (command === 'npm' || command === 'npx'),
    stdio: ['ignore', 'pipe', 'inherit'],
    maxBuffer: 256 * 1024 * 1024,
  });
}
