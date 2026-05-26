import cron from 'node-cron';
import pino from 'pino';
import { prisma } from '@crossbar/db';
import {
  fairValueFor,
  houseMaker,
  pinnacle,
  contrarian,
  momentum,
  random,
  type Bot,
  type MarketContext,
} from '@crossbar/bots';
import { ApiClient } from './api-client.js';
import { ensureBotAccounts, type ActiveBot } from './bot-accounts.js';

const log = pino({
  transport:
    process.env.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined,
});

const API_URL = process.env.API_URL ?? 'http://localhost:4000';
const TICK_CRON = process.env.MAKER_CRON ?? '*/30 * * * * *';

const BOTS: Record<string, Bot> = {
  bot_house: houseMaker,
  bot_pinnacle: pinnacle,
  bot_contrarian: contrarian,
  bot_momentum: momentum,
  bot_random: random,
};

let tickInFlight = false;

async function tick(api: ApiClient, bots: ActiveBot[]): Promise<void> {
  if (tickInFlight) {
    log.warn('previous tick still running — skipping');
    return;
  }
  tickInFlight = true;
  const started = Date.now();

  try {
    const markets = (await api.listMarkets()).filter((m) => m.status === 'OPEN');
    if (markets.length === 0) {
      log.info('no open markets — idle tick');
      return;
    }

    const eventIds = [...new Set(markets.map((m) => m.event.id))];
    const events = await prisma.event.findMany({
      where: { id: { in: eventIds } },
      select: {
        id: true,
        sportId: true,
        startsAt: true,
        status: true,
        spread: true,
        overUnder: true,
        homeMoneyLine: true,
        awayMoneyLine: true,
        homeTeam: true,
        awayTeam: true,
      },
    });
    const eventById = new Map(events.map((e) => [e.id, e]));

    let ordersPlaced = 0;
    let ordersCancelled = 0;
    let ordersRejected = 0;

    for (const bot of bots) {
      const strategy = BOTS[bot.username];
      if (!strategy) continue;
      const isMaker = bot.username === 'bot_house';
      if (isMaker) {
        const open = await api.myOrders(bot.token);
        for (const o of open.orders) {
          await api.cancelOrder(bot.token, o.id).catch(() => null);
          ordersCancelled += 1;
        }
      }
      for (const market of markets) {
        const event = eventById.get(market.event.id);
        if (!event) continue;
        const fair = fairValueFor({ type: market.type, line: market.line }, event);
        const trades = await api.marketTrades(market.id, 10);
        const ctx: MarketContext = {
          market,
          event,
          recentTrades: trades.trades,
          fairYes: fair.yesCents,
          fairConfidence: fair.confidence,
        };
        const desired = strategy.decide(ctx);
        for (const order of desired) {
          try {
            await api.placeOrder(bot.token, { marketId: market.id, ...order });
            ordersPlaced += 1;
          } catch {
            ordersRejected += 1;
          }
        }
      }
    }

    log.info(
      { ms: Date.now() - started, markets: markets.length, ordersPlaced, ordersCancelled, ordersRejected },
      'tick complete',
    );
  } catch (err) {
    log.error({ err }, 'tick failed');
  } finally {
    tickInFlight = false;
  }
}

async function main(): Promise<void> {
  log.info({ apiUrl: API_URL, cron: TICK_CRON }, 'crossbar maker starting');
  const api = new ApiClient({ baseUrl: API_URL, log });
  const bots = await ensureBotAccounts(api, log);
  log.info({ bots: bots.map((b) => b.username) }, 'bot accounts ready');

  void tick(api, bots);
  const task = cron.schedule(TICK_CRON, () => void tick(api, bots));

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
