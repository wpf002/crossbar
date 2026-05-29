import { defineConfig } from 'vitest/config';

// Pure parsing/HTTP-client package — no database, no global setup.
export default defineConfig({
  test: {
    environment: 'node',
  },
});
