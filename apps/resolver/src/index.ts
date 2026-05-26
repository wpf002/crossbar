import cron from 'node-cron';
import pino from 'pino';
import { prisma } from '@crossbar/db';
import { SPORTS, type SportId } from '@crossbar/shared';
import { ingestSport } from './ingest.js';
import { applyEventTransitions } from './transitions.js';

const log = pino({
  transport:
    process.env.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined,
});

let tickInFlight = false;

async function tick(): Promise<void> {
  if (tickInFlight) {
    log.warn('previous tick still running — skipping');
    return;
  }
  tickInFlight = true;
  const started = Date.now();
  try {
    for (const sport of SPORTS) {
      const result = await ingestSport(sport as SportId, { prisma, log });
      for (const event of result.updatedEvents) {
        await applyEventTransitions(event, { prisma, log });
      }
    }
    log.info({ ms: Date.now() - started }, 'tick complete');
  } catch (err) {
    log.error({ err }, 'tick failed');
  } finally {
    tickInFlight = false;
  }
}

async function main(): Promise<void> {
  log.info('crossbar resolver starting');

  // Run once on boot, then every minute.
  void tick();
  const task = cron.schedule('* * * * *', () => {
    void tick();
  });

  const shutdown = async (): Promise<void> => {
    log.info('shutting down');
    task.stop();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err: unknown) => {
  log.error({ err }, 'fatal startup error');
  process.exit(1);
});
