import { prisma } from '@crossbar/db';
import type { Logger } from 'pino';
import type { ApiClient } from './api-client.js';

export interface BotIdentity {
  username: string;
  email: string;
  /** Initial wallet balance in cents. */
  startingBalanceCents: number;
}

export interface ActiveBot extends BotIdentity {
  userId: string;
  token: string;
}

export const BOT_DEFS: BotIdentity[] = [
  // The market-maker — large bankroll, quotes both sides.
  { username: 'bot_house', email: 'bot_house@crossbar.bot', startingBalanceCents: 10_000_000_00 }, // $10M
  // Directional bots — modest bankrolls.
  { username: 'bot_pinnacle', email: 'bot_pinnacle@crossbar.bot', startingBalanceCents: 1_000_000_00 },
  { username: 'bot_contrarian', email: 'bot_contrarian@crossbar.bot', startingBalanceCents: 1_000_000_00 },
  { username: 'bot_momentum', email: 'bot_momentum@crossbar.bot', startingBalanceCents: 1_000_000_00 },
  { username: 'bot_random', email: 'bot_random@crossbar.bot', startingBalanceCents: 1_000_000_00 },
];

const BOT_PASSWORD = process.env.BOT_PASSWORD ?? 'crossbar-bot-secret-please-change';

/**
 * Idempotently ensures all bot accounts exist and have at least their starting
 * balance topped up. Returns each bot's userId + JWT.
 */
export async function ensureBotAccounts(
  api: ApiClient,
  log: Logger,
): Promise<ActiveBot[]> {
  const out: ActiveBot[] = [];

  for (const def of BOT_DEFS) {
    const auth = await api.signupOrLogin({
      username: def.username,
      email: def.email,
      password: BOT_PASSWORD,
    });

    // Top up wallet to at least the starting balance. We never withdraw — if a
    // bot accumulates more than starting, leave it as-is so we can see PnL.
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: auth.user.id } });
    const needed = def.startingBalanceCents - wallet.balance;
    if (needed > 0) {
      await prisma.wallet.update({
        where: { userId: auth.user.id },
        data: { balance: { increment: needed } },
      });
      log.info(
        { bot: def.username, topUp: needed, finalBalance: def.startingBalanceCents },
        'topped up bot wallet',
      );
    }

    out.push({
      ...def,
      userId: auth.user.id,
      token: auth.token,
    });
  }

  return out;
}
