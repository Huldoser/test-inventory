// @ts-check
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/', 'coverage/', 'docs/.vitepress/cache/', 'docs/.vitepress/dist/', 'docs/api/', 'tests/fixtures/'],
  },

  // TypeScript sources, scripts and tests, with type information.
  {
    files: ['**/*.ts'],
    extends: [tseslint.configs.strictTypeChecked, tseslint.configs.stylisticTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      eqeqeq: 'error',
      'no-console': 'error',
      'prefer-const': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      // Template literals in messages interpolate numbers and booleans on purpose.
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true, allowBoolean: true }],
      // `as string` is used where the AST types allow null but the syntax rules it out; `!` is banned by strict.
      '@typescript-eslint/non-nullable-type-assertion-style': 'off',
    },
  },

  // Scripts report to the terminal.
  { files: ['scripts/**/*.ts'], rules: { 'no-console': 'off' } },

  // Plain JavaScript: config files.
  {
    files: ['**/*.{js,mjs}'],
    extends: [tseslint.configs.disableTypeChecked],
    rules: { eqeqeq: 'error', 'prefer-const': 'error' },
  },
);
