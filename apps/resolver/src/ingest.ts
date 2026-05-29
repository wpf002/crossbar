import type { Event, PrismaClient } from '@prisma/client';
import type { SportId, SportEvent } from '@crossbar/shared';
import type { Logger } from 'pino';
import { fetchScoreboard as defaultFetch } from '@crossbar/sports';

export interface IngestDeps {
  prisma: PrismaClient;
  log: Logger;
  /** Injectable for tests. */
  fetchScoreboard?: (sport: SportId) => Promise<SportEvent[]>;
}

export interface IngestResult {
  sport: SportId;
  fetched: number;
  upserted: number;
  marketsCreated: number;
  updatedEvents: Event[];
}

/**
 * Poll ESPN for one sport, upsert events, create markets on first encounter.
 * Returns the events that were touched (so the caller can run transitions).
 */
export async function ingestSport(
  sport: SportId,
  deps: IngestDeps,
): Promise<IngestResult> {
  const { prisma, log } = deps;
  const fetcher = deps.fetchScoreboard ?? defaultFetch;

  // Ensure the Sport row exists so the FK is valid.
  await prisma.sport.upsert({
    where: { id: sport },
    update: {},
    create: { id: sport, name: sport.toUpperCase() },
  });

  let espnEvents: SportEvent[];
  try {
    espnEvents = await fetcher(sport);
  } catch (err) {
    log.warn({ err, sport }, 'fetchScoreboard failed');
    return {
      sport,
      fetched: 0,
      upserted: 0,
      marketsCreated: 0,
      updatedEvents: [],
    };
  }

  let upserted = 0;
  let marketsCreated = 0;
  const updatedEvents: Event[] = [];

  for (const ev of espnEvents) {
    const event = await prisma.event.upsert({
      where: { sportId_externalId: { sportId: sport, externalId: ev.externalId } },
      create: {
        sportId: sport,
        externalId: ev.externalId,
        homeTeam: ev.homeTeam,
        awayTeam: ev.awayTeam,
        startsAt: new Date(ev.startsAt),
        status: ev.status,
        homeScore: ev.homeScore ?? null,
        awayScore: ev.awayScore ?? null,
        period: ev.period ?? null,
        displayClock: ev.displayClock ?? null,
        spread: ev.spread ?? null,
        overUnder: ev.overUnder ?? null,
        homeMoneyLine: ev.homeMoneyLine ?? null,
        awayMoneyLine: ev.awayMoneyLine ?? null,
      },
      update: {
        homeTeam: ev.homeTeam,
        awayTeam: ev.awayTeam,
        status: ev.status,
        homeScore: ev.homeScore ?? null,
        awayScore: ev.awayScore ?? null,
        period: ev.period ?? null,
        displayClock: ev.displayClock ?? null,
        spread: ev.spread ?? null,
        overUnder: ev.overUnder ?? null,
        homeMoneyLine: ev.homeMoneyLine ?? null,
        awayMoneyLine: ev.awayMoneyLine ?? null,
      },
    });
    upserted += 1;
    updatedEvents.push(event);

    // Only create markets if the event has no live (non-VOIDED) markets yet.
    const existingMarkets = await prisma.market.findMany({
      where: { eventId: event.id, status: { not: 'VOIDED' } },
      select: { id: true, type: true },
    });
    if (existingMarkets.length > 0) continue;

    const created = await createMarketsForEvent(prisma, event, ev);
    marketsCreated += created;
  }

  log.info(
    { sport, fetched: espnEvents.length, upserted, marketsCreated },
    'ingestSport complete',
  );

  return {
    sport,
    fetched: espnEvents.length,
    upserted,
    marketsCreated,
    updatedEvents,
  };
}

async function createMarketsForEvent(
  prisma: PrismaClient,
  event: Event,
  espn: SportEvent,
): Promise<number> {
  let created = 0;

  await prisma.market.create({
    data: {
      eventId: event.id,
      type: 'MONEYLINE',
      question: `Will the ${event.homeTeam} beat the ${event.awayTeam}?`,
      yesLabel: `${event.homeTeam} wins`,
      noLabel: `${event.awayTeam} wins`,
    },
  });
  created += 1;

  if (typeof espn.overUnder === 'number') {
    await prisma.market.create({
      data: {
        eventId: event.id,
        type: 'TOTAL',
        question: `Will combined score go OVER ${espn.overUnder}?`,
        yesLabel: `Over ${espn.overUnder}`,
        noLabel: `Under ${espn.overUnder}`,
        line: espn.overUnder,
      },
    });
    created += 1;
  }

  if (typeof espn.spread === 'number') {
    const line = espn.spread;
    await prisma.market.create({
      data: {
        eventId: event.id,
        type: 'SPREAD',
        question: `Will ${event.homeTeam} cover ${formatSigned(line)}?`,
        yesLabel: `${event.homeTeam} ${formatSigned(line)}`,
        noLabel: `${event.awayTeam} ${formatSigned(-line)}`,
        line,
      },
    });
    created += 1;
  }

  return created;
}

function formatSigned(n: number): string {
  return n > 0 ? `+${n}` : `${n}`;
}
