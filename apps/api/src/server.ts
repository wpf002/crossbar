import type { EngineContext } from '@crossbar/engine';
import { buildApp, hydrateBooksFromDb } from './app.js';
import { prisma } from './lib/prisma.js';
import { loadEnv } from './env.js';

async function main(): Promise<void> {
  const env = loadEnv();

  const books = await hydrateBooksFromDb();
  const engineCtx: EngineContext = { prisma, books };

  const app = await buildApp({ env, engineCtx });

  await app.listen({ port: env.API_PORT, host: '0.0.0.0' });
  app.log.info(`crossbar api listening on :${env.API_PORT}`);
}

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error('fatal startup error', err);
  process.exit(1);
});
