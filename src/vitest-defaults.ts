/** Vitest's default file settings, as `configDefaults` in `vitest/config` holds them. */
export const VITEST_INCLUDE = ['**/*.{test,spec}.?(c|m)[jt]s?(x)'];
export const VITEST_TYPECHECK_INCLUDE = ['**/*.{test,spec}-d.?(c|m)[jt]s?(x)'];
export const VITEST_BENCHMARK_INCLUDE = ['**/*.{bench,benchmark}.?(c|m)[jt]s?(x)'];

/** Vitest's default `exclude`: Vitest 4 left out the folders and tool configs that Vitest 3 excludes. */
export function vitestExclude(version: [number, number] | null): string[] {
  if (version === null || version[0] >= 4) return ['**/node_modules/**', '**/.git/**'];
  return [
    '**/node_modules/**',
    '**/dist/**',
    '**/cypress/**',
    '**/.{idea,git,cache,output,temp}/**',
    '**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build,eslint,prettier}.config.*',
  ];
}
