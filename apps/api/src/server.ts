import { buildApp } from './app.js';
import { loadEnv } from './env.js';

async function main(): Promise<void> {
  const env = loadEnv();

  // Orders flow through the matcher service (apps/matcher) — start it with
  // `pnpm dev:matcher`. The API no longer holds any in-memory order books.
  const app = await buildApp({ env });

  await app.listen({ port: env.API_PORT, host: '0.0.0.0' });
  app.log.info(`crossbar api listening on :${env.API_PORT}`);
}

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error('fatal startup error', err);
  process.exit(1);
});
