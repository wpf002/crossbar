import path from 'node:path';
import { defineConfig, env } from 'prisma/config';

// Prisma 7 doesn't auto-load .env before evaluating this config, but the
// repo keeps DATABASE_URL there. Load it ourselves (Node 20.12+ built-in).
try {
  process.loadEnvFile('.env');
} catch {
  // .env missing is fine — the value may already be in process.env.
}

export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  datasource: {
    url: env('DATABASE_URL'),
  },
  migrations: {
    path: path.join('prisma', 'migrations'),
    seed: 'tsx prisma/seed.ts',
  },
});
