// Lint rules for the whole workspace. The working agreement is in the `project`
// repository under docs/process/code-quality.md: any analyzer warning blocks a
// merge, and a suppression is inline on the line it applies to, never a rule
// turned off across the project.
//
// Formatting is Prettier's job and is deliberately absent here, so the two
// tools never disagree about the same line.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'node_modules/',
      'site/',
      'coverage/',
      'dist/',
      'tokens/build/',
      'apps/*/drizzle/',
      'apps/*/openapi.json',
    ],
  },
  js.configs.recommended,
  // Type-aware linting, which is the half that catches floating promises and
  // unsafe `any` flowing across boundaries. It needs a tsconfig per file.
  ...tseslint.configs.recommendedTypeChecked,
  {
    files: ['apps/**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // An unawaited promise is the most common way an async bug reaches
      // production looking like a race condition.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      // An unused argument prefixed with an underscore is a deliberate
      // signature match, not a leftover.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  // Config files sit outside every tsconfig, so type-aware rules cannot run on
  // them. Syntax rules still do.
  {
    files: ['*.mjs', '*.js', 'vitest.config.mts'],
    ...tseslint.configs.disableTypeChecked,
  },
);
