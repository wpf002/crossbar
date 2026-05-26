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
      REDIS_URL: process.env.TEST_REDIS_URL ?? 'redis://localhost:6379',
    },
    testTimeout: 30000,
    hookTimeout: 60000,
    fileParallelism: false,
  },
});
