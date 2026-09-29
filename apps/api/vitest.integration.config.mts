import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// Integration tests run against your local PostgreSQL (ADR-0012). Each test file creates
// its own throw-away database; set DATABASE_ADMIN_URL in the repository's .env file.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['test/**/*.int.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 180_000,
    fileParallelism: false,
  },
});
