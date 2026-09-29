// End-to-end tests (`pnpm test:e2e`): files named *.e2e-spec.ts in this folder. They start the
// real app and call it over HTTP, against a temporary database made for this run.
import type { Config } from 'jest';

const config: Config = {
  rootDir: '.',
  testRegex: '.*\\.e2e-spec\\.ts$',
  moduleFileExtensions: ['js', 'json', 'ts'],
  transform: { '^.+\\.ts$': 'ts-jest' },
  testEnvironment: 'node',
  globalSetup: '<rootDir>/global-setup.ts',
  globalTeardown: '<rootDir>/global-teardown.ts',
  setupFiles: ['<rootDir>/setup-env.ts'],
  testTimeout: 30_000,
};

export default config;
