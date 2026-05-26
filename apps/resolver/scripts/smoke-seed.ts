/* eslint-disable no-console */
import pino from 'pino';
import { prisma } from '@crossbar/db';
import type { SportEvent } from '@crossbar/shared';
import { ingestSport } from '../src/ingest.js';

const log = pino({ level: 'info' });

async function main(): Promise<void> {
  const now = Date.now();
  const fixture: SportEvent[] = [
    {
      externalId: `smoke-${now}`,
      sportId: 'mlb',
      homeTeam: 'Yankees',
      awayTeam: 'Red Sox',
      startsAt: new Date(now + 2 * 3600_000).toISOString(),
      status: 'SCHEDULED',
      overUnder: 8.5,
      spread: -1.5,
    },
  ];

  const result = await ingestSport('mlb', {
    prisma,
    log,
    fetchScoreboard: async () => fixture,
  });

  console.log(JSON.stringify(
    {
      fetched: result.fetched,
      upserted: result.upserted,
      marketsCreated: result.marketsCreated,
      eventIds: result.updatedEvents.map((e) => e.id),
    },
    null,
    2,
  ));

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
