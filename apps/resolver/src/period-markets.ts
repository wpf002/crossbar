import type { Event, PrismaClient } from '@prisma/client';
import type { Logger } from 'pino';
import { PERIOD_CONFIG, periodLabel, periodWinnerQuestion, type SportId } from '@crossbar/shared';

export interface PeriodMarketDeps {
  prisma: PrismaClient;
  log: Logger;
}

/**
 * Open one period-winner market per regulation period for a live event
 * (e.g. NFL Q1–Q4, NHL P1–P3, MLB innings 1–9). Idempotent — only creates
 * periods that don't already have a market. Each resolves when its period ends.
 */
export async function ensurePeriodMarkets(
  event: Event,
  deps: PeriodMarketDeps,
): Promise<number> {
  const sport = event.sportId as SportId;
  const config = PERIOD_CONFIG[sport];
  if (!config) return 0;

  const existing = await deps.prisma.market.findMany({
    where: { eventId: event.id, type: 'PERIOD_WINNER' },
    select: { period: true },
  });
  const seen = new Set(existing.map((m) => m.period));

  let created = 0;
  for (let period = 1; period <= config.count; period++) {
    if (seen.has(period)) continue;
    const label = periodLabel(sport, period);
    await deps.prisma.market.create({
      data: {
        eventId: event.id,
        type: 'PERIOD_WINNER',
        period,
        question: periodWinnerQuestion(event.homeTeam, event.awayTeam, sport, period),
        yesLabel: `${event.homeTeam} (${label})`,
        noLabel: `${event.awayTeam} (${label})`,
      },
    });
    created += 1;
  }

  if (created > 0) {
    deps.log.info({ eventId: event.id, created }, 'created period-winner markets');
  }
  return created;
}
