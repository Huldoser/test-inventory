import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Framework, Inventory } from '../src/index.ts';

export const fixtures = path.resolve(import.meta.dirname, 'fixtures');

/** The example projects in tests/fixtures, each with its scan output in tests/golden. The docs show these. */
export const EXAMPLES: { name: string; framework: Framework; patterns: string[] }[] = [
  { name: 'trading-web', framework: 'playwright', patterns: ['tests/**/*.spec.ts'] },
  { name: 'strategy-engine', framework: 'vitest', patterns: ['tests/**/*.{test,test-d}.ts', 'src/**/*.ts'] },
  { name: 'order-service', framework: 'vitest', patterns: ['tests/**/*.test.ts'] },
  { name: 'trading-dashboard', framework: 'vitest', patterns: ['src/**/*.test.tsx'] },
  { name: 'watchlist-vue', framework: 'vitest', patterns: ['tests/unit/**/*.spec.ts'] },
  { name: 'chart-browser', framework: 'vitest', patterns: ['src/**/*.test.ts'] },
  { name: 'trading-monorepo', framework: 'vitest', patterns: ['packages/*/src/**/*.test.ts'] },
];

export function goldenPath(name: string): string {
  return path.resolve(import.meta.dirname, 'golden', `${name}.json`);
}

export function readGolden(name: string): Inventory {
  return JSON.parse(readFileSync(goldenPath(name), 'utf8')) as Inventory;
}
