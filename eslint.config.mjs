/**
 * Code rules for the whole backend repository (`pnpm lint`).
 * Each block below says which files it applies to and why.
 */
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    // Generated or downloaded files are never linted.
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.turbo/**',
      '**/coverage/**',
      'packages/contracts/src/generated/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Every file.
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', disallowTypeAnnotations: false, fixStyle: 'inline-type-imports' },
      ],
      // Use the logger (createLogger in server-kit) so output is structured and redacted.
      'no-console': 'error',
    },
  },
  {
    // NestJS reads constructor parameter types at runtime (emitDecoratorMetadata), so classes
    // injected through constructors must be value imports, never `import type`.
    files: ['apps/**/src/**/*.ts', 'services/**/src/**/*.ts'],
    rules: {
      '@typescript-eslint/consistent-type-imports': 'off',
    },
  },
  {
    // A service may use another service only through its public interface (ADR-0011).
    files: ['services/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^@eduplatform/[a-z-]+-service$',
              message:
                "Import another service's public interface: '@eduplatform/<name>-service/public'.",
            },
          ],
        },
      ],
    },
  },
  {
    // Command-line scripts print to the terminal on purpose.
    files: ['**/scripts/**/*.mjs', '**/*.cli.ts', 'infra/**/*.mjs'],
    rules: { 'no-console': 'off' },
  },
);
