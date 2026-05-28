import { defineConfig } from 'vitest/config';

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://crossbar:crossbar@localhost:5432/crossbar_test';

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
      JWT_SECRET: 'test-jwt-secret-1234567890',
      // Separate Redis DB from dev (db0) so `pnpm dev` and the test suite
      // can run at the same time without fighting over the orders stream.
      REDIS_URL: process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/1',
    },
    testTimeout: 30000,
    hookTimeout: 60000,
    fileParallelism: false,
  },
});
