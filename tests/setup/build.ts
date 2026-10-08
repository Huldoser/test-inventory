import { execFileSync } from 'node:child_process';
import path from 'node:path';

/** The CLI tests run the built binary, so build it once before any test file runs. */
export default function build(): void {
  const root = path.resolve(import.meta.dirname, '../..');
  execFileSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.build.json'], {
    cwd: root,
    stdio: 'inherit',
  });
}
