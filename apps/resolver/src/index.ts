import cron from 'node-cron';
import pino from 'pino';
import { prisma } from '@crossbar/db';
import { SPORTS, type SportId } from '@crossbar/shared';
import { liveSports, runTick, type TickDeps } from './tick.js';

// Auto-generate player-prop markets from live box scores. Off by default —
// prop volume is large, so the operator opts in explicitly.
const AUTOGEN_PROPS = process.env.PLAYER_PROPS_AUTOGEN === 'true';

// Auto-generate per-period winner markets for live games. On by default —
// bounded volume (a handful per game) and it's the core live-markets feature.
const PERIOD_MARKETS = process.env.LIVE_PERIOD_MARKETS !== 'false';

// How often to re-poll sports with a game in progress. ESPN scoreboards update
// within a few seconds; 10s keeps live scores/props fresh without hammering.
const LIVE_POLL_SECONDS = clampInt(process.env.LIVE_POLL_SECONDS, 10, 5, 60);

const log = pino({
  transport:
    process.env.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined,
});

const deps: TickDeps = {
  prisma,
  log,
  autogenProps: AUTOGEN_PROPS,
  periodMarkets: PERIOD_MARKETS,
};

// A single guard serializes the full and live ticks so they never overlap and
// double-ingest the same event.
let tickInFlight = false;

async function guarded(label: 'full' | 'live', fn: () => Promise<void>): Promise<void> {
  if (tickInFlight) {
    log.debug({ label }, 'tick busy — skipping');
    return;
  }
  tickInFlight = true;
  const started = Date.now();
  try {
    await fn();
    log.info({ label, ms: Date.now() - started }, 'tick complete');
  } catch (err) {
    log.error({ err, label }, 'tick failed');
  } finally {
    tickInFlight = false;
  }
}

async function main(): Promise<void> {
  log.info({ livePollSeconds: LIVE_POLL_SECONDS }, 'crossbar resolver starting');

  // Full poll across all sports: once on boot, then every minute.
  void guarded('full', () => runTick(SPORTS as readonly SportId[], deps));
  const fullTask = cron.schedule('* * * * *', () => {
    void guarded('full', () => runTick(SPORTS as readonly SportId[], deps));
  });

  // Fast poll for in-progress games only.
  const liveTimer = setInterval(() => {
    void guarded('live', async () => {
      const sports = await liveSports(prisma);
      if (sports.length === 0) return;
      await runTick(sports, deps);
    });
  }, LIVE_POLL_SECONDS * 1000);

  const shutdown = async (): Promise<void> => {
    log.info('shutting down');
    fullTask.stop();
    clearInterval(liveTimer);
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

function clampInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

main().catch((err: unknown) => {
  log.error({ err }, 'fatal startup error');
  process.exit(1);
});
