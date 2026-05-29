import { describe, it, expect } from 'vitest';
import pino from 'pino';
import type { Event } from '@prisma/client';
import { prisma } from '@crossbar/db';
import type { EventSummary } from '@crossbar/shared';
import { reconcileMissingLive } from './reconcile.js';

const log = pino({ level: 'silent' });

async function liveEvent(externalId: string, opts: Partial<Event> = {}): Promise<Event> {
  await prisma.sport.upsert({ where: { id: 'mlb' }, update: {}, create: { id: 'mlb', name: 'MLB' } });
  const event = await prisma.event.create({
    data: {
      sportId: 'mlb',
      externalId,
      homeTeam: 'Yankees',
      awayTeam: 'Red Sox',
      startsAt: new Date(Date.now() - 60 * 60_000),
      status: 'LIVE',
      ...opts,
    },
  });
  await prisma.market.create({
    data: {
      eventId: event.id,
      type: 'MONEYLINE',
      question: 'Will the Yankees beat the Red Sox?',
      yesLabel: 'Yankees',
      noLabel: 'Red Sox',
    },
  });
  return event;
}

const sum = (game: EventSummary['game']): EventSummary => ({ game, players: [] });

describe('reconcileMissingLive', () => {
  it('finalizes an orphaned LIVE event from the summary and resolves its markets', async () => {
    await liveEvent('orph-1');

    const n = await reconcileMissingLive('mlb', new Set(), {
      prisma,
      log,
      fetchEventSummary: async () => sum({ status: 'FINAL', homeScore: 5, awayScore: 2 }),
    });

    expect(n).toBe(1);
    const ev = await prisma.event.findFirstOrThrow({ where: { externalId: 'orph-1' } });
    expect(ev.status).toBe('FINAL');
    const mk = await prisma.market.findFirstOrThrow({ where: { eventId: ev.id } });
    expect(mk.status).toBe('RESOLVED');
    expect(mk.outcome).toBe('YES'); // 5 > 2
  });

  it('leaves events still in the scoreboard alone', async () => {
    await liveEvent('seen-1');
    const n = await reconcileMissingLive('mlb', new Set(['seen-1']), {
      prisma,
      log,
      fetchEventSummary: async () => sum({ status: 'FINAL', homeScore: 1, awayScore: 0 }),
    });
    expect(n).toBe(0);
    const ev = await prisma.event.findFirstOrThrow({ where: { externalId: 'seen-1' } });
    expect(ev.status).toBe('LIVE');
  });

  it('falls back to last-known score when the summary is unreachable and the game is stale', async () => {
    await liveEvent('orph-stale', {
      startsAt: new Date(Date.now() - 7 * 60 * 60_000),
      homeScore: 4,
      awayScore: 1,
    });

    const n = await reconcileMissingLive('mlb', new Set(), {
      prisma,
      log,
      fetchEventSummary: async () => {
        throw new Error('not found');
      },
    });
    expect(n).toBe(1);
    const ev = await prisma.event.findFirstOrThrow({ where: { externalId: 'orph-stale' } });
    expect(ev.status).toBe('FINAL');
    const mk = await prisma.market.findFirstOrThrow({ where: { eventId: ev.id } });
    expect(mk.outcome).toBe('YES'); // 4 > 1
  });

  it('does not finalize a recent orphan when the summary is unreachable', async () => {
    await liveEvent('orph-recent', { homeScore: 2, awayScore: 2 });
    const n = await reconcileMissingLive('mlb', new Set(), {
      prisma,
      log,
      fetchEventSummary: async () => {
        throw new Error('not found');
      },
    });
    expect(n).toBe(0);
    const ev = await prisma.event.findFirstOrThrow({ where: { externalId: 'orph-recent' } });
    expect(ev.status).toBe('LIVE');
  });
});
