import { defineConfig } from 'vitest/config';

// Use a dedicated DB so we don't race with the engine/api test suites,
// which run in parallel against `crossbar_test`.
const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://crossbar:crossbar@localhost:5432/crossbar_test_resolver';

export default defineConfig({
  test: {
    globalSetup: ['./vitest.global-setup.ts'],
    setupFiles: ['./vitest.setup.ts'],
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },
    },
    env: {
      DATABASE_URL: TEST_DATABASE_URL,
      NODE_ENV: 'test',
    },
    testTimeout: 30000,
    hookTimeout: 60000,
    fileParallelism: false,
  },
});
