import { execSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://crossbar:crossbar@localhost:5432/crossbar_test_resolver';
const TEST_DB_NAME = new URL(TEST_DATABASE_URL).pathname.replace(/^\//, '');

const here = dirname(fileURLToPath(import.meta.url));
const dbPackageDir = resolve(here, '..', '..', 'packages', 'db');

function ensureTestDatabase(): void {
  const check = spawnSync(
    'docker',
    [
      'exec',
      'crossbar_postgres',
      'psql',
      '-U',
      'crossbar',
      '-d',
      'postgres',
      '-tAc',
      `SELECT 1 FROM pg_database WHERE datname='${TEST_DB_NAME}'`,
    ],
    { encoding: 'utf8' },
  );

  if (check.status !== 0) {
    throw new Error(
      `Could not reach postgres via docker. Is 'pnpm infra:up' running?\n${check.stderr}`,
    );
  }

  if (check.stdout.trim() === '1') return;

  const create = spawnSync(
    'docker',
    [
      'exec',
      'crossbar_postgres',
      'psql',
      '-U',
      'crossbar',
      '-d',
      'postgres',
      '-c',
      `CREATE DATABASE ${TEST_DB_NAME}`,
    ],
    { encoding: 'utf8' },
  );
  if (create.status !== 0) {
    throw new Error(`Failed to create test database: ${create.stderr}`);
  }
}

export async function setup(): Promise<void> {
  ensureTestDatabase();
  execSync('pnpm exec prisma migrate deploy', {
    cwd: dbPackageDir,
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: 'inherit',
  });
}

export async function teardown(): Promise<void> {
  // Leave the test DB around for inspection.
}
