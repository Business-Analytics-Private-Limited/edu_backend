// Unit tests (`pnpm test`): files named *.spec.ts next to the code. No database needed.
import type { Config } from 'jest';

const config: Config = {
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  moduleFileExtensions: ['js', 'json', 'ts'],
  transform: { '^.+\\.ts$': 'ts-jest' },
  testEnvironment: 'node',
};

export default config;
