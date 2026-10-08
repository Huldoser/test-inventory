import { readFileSync } from 'node:fs';

/** The version of this package, read from its package.json in both the sources and the build. */
export const toolVersion: string = (
  JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }
).version;
