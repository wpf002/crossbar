import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  closeMarket,
  createMarket,
  resolveMarket,
  voidMarket,
  type EngineContext,
} from '@crossbar/engine';
import { prisma } from '../lib/prisma.js';
import { HttpError } from '../lib/errors.js';
import type { EventBus } from '../lib/events.js';
import { publishLifecycleEffects } from '../lib/publish-effects.js';

interface AdminDeps {
  engineCtx: EngineContext;
  bus: EventBus;
}

const CreateMarketSchema = z.object({
  eventId: z.string().min(1),
  type: z.enum(['MONEYLINE', 'TOTAL', 'SPREAD']),
  line: z.number().optional(),
  question: z.string().optional(),
  yesLabel: z.string().optional(),
  noLabel: z.string().optional(),
});

const ResolveSchema = z.object({
  outcome: z.enum(['YES', 'NO', 'INVALID']),
});

const VoidSchema = z.object({
  reason: z.string().min(1).max(500),
});

const FinalizeEventSchema = z.object({
  homeScore: z.number().int().min(0),
  awayScore: z.number().int().min(0),
});

const TopupSchema = z.object({
  amount: z.number().int().refine((v) => v !== 0, 'amount must be non-zero'),
});

const PaginationSchema = z.object({
  limit: z.coerce.number().int().positive().max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

const MarketStatusEnum = z.enum(['OPEN', 'CLOSED', 'RESOLVED', 'VOIDED']);
const EventStatusEnum = z.enum(['SCHEDULED', 'LIVE', 'FINAL', 'POSTPONED', 'CANCELED']);

export default function adminRoutes(deps: AdminDeps) {
  const { engineCtx, bus } = deps;

  return async function (fastify: FastifyInstance): Promise<void> {
    fastify.addHook('preHandler', fastify.requireAdmin);

    // ─── Stats ────────────────────────────────────────────────────────────
    fastify.get('/stats', async () => {
      const since = new Date(Date.now() - 24 * 3600_000);
      const [marketCounts, userCount, volumeRows] = await Promise.all([
        prisma.market.groupBy({ by: ['status'], _count: { _all: true } }),
        prisma.user.count(),
        prisma.trade.findMany({
          where: { createdAt: { gte: since } },
          select: { price: true, quantity: true },
        }),
      ]);
      const byStatus: Record<string, number> = {
        OPEN: 0,
        CLOSED: 0,
        RESOLVED: 0,
        VOIDED: 0,
      };
      for (const m of marketCounts) {
        byStatus[m.status] = m._count._all;
      }
      const volume24h = volumeRows.reduce((a, t) => a + t.price * t.quantity, 0);
      return { marketsByStatus: byStatus, userCount, volume24h };
    });

    // ─── Markets ──────────────────────────────────────────────────────────
    fastify.get('/markets', async (req) => {
      const query = z
        .object({
          status: MarketStatusEnum.optional(),
          sport: z.string().optional(),
        })
        .merge(PaginationSchema)
        .parse(req.query);

      const markets = await prisma.market.findMany({
        where: {
          ...(query.status ? { status: query.status } : {}),
          ...(query.sport ? { event: { sportId: query.sport } } : {}),
        },
        include: {
          event: {
            select: {
              id: true,
              sportId: true,
              homeTeam: true,
              awayTeam: true,
              startsAt: true,
              status: true,
              homeScore: true,
              awayScore: true,
            },
          },
        },
        orderBy: [{ status: 'asc' }, { event: { startsAt: 'asc' } }],
        take: query.limit,
        skip: query.offset,
      });

      return markets.map((m) => ({
        id: m.id,
        type: m.type,
        question: m.question,
        line: m.line,
        status: m.status,
        outcome: m.outcome,
        closedAt: m.closedAt?.toISOString() ?? null,
        resolvedAt: m.resolvedAt?.toISOString() ?? null,
        event: {
          id: m.event.id,
          sportId: m.event.sportId,
          homeTeam: m.event.homeTeam,
          awayTeam: m.event.awayTeam,
          startsAt: m.event.startsAt.toISOString(),
          status: m.event.status,
          homeScore: m.event.homeScore,
          awayScore: m.event.awayScore,
        },
      }));
    });

    fastify.post('/markets', async (req) => {
      const input = CreateMarketSchema.parse(req.body);
      const market = await createMarket(prisma, input);
      return { market: serializeMarket(market) };
    });

    fastify.post<{ Params: { id: string } }>('/markets/:id/close', async (req) => {
      const result = await closeMarket(prisma, req.params.id);
      await publishLifecycleEffects(
        bus,
        prisma,
        engineCtx,
        req.params.id,
        result.canceledOrders.map((o) => o.userId),
      );
      return {
        market: serializeMarket(result.market),
        canceledOrderIds: result.canceledOrders.map((o) => o.id),
      };
    });

    fastify.post<{ Params: { id: string } }>('/markets/:id/resolve', async (req) => {
      const { outcome } = ResolveSchema.parse(req.body);
      const result = await resolveMarket(prisma, req.params.id, outcome);
      await publishLifecycleEffects(
        bus,
        prisma,
        engineCtx,
        req.params.id,
        result.payouts.map((p) => p.userId),
      );
      return {
        market: serializeMarket(result.market),
        payouts: result.payouts,
      };
    });

    fastify.post<{ Params: { id: string } }>('/markets/:id/void', async (req) => {
      const { reason } = VoidSchema.parse(req.body);
      const result = await voidMarket(prisma, req.params.id, reason);
      await publishLifecycleEffects(
        bus,
        prisma,
        engineCtx,
        req.params.id,
        result.refunds.map((r) => r.userId),
      );
      return {
        market: serializeMarket(result.market),
        refunds: result.refunds,
      };
    });

    // ─── Events ───────────────────────────────────────────────────────────
    fastify.get('/events', async (req) => {
      const query = z
        .object({
          status: EventStatusEnum.optional(),
          sport: z.string().optional(),
        })
        .merge(PaginationSchema)
        .parse(req.query);

      const events = await prisma.event.findMany({
        where: {
          ...(query.status ? { status: query.status } : {}),
          ...(query.sport ? { sportId: query.sport } : {}),
        },
        orderBy: { startsAt: 'desc' },
        take: query.limit,
        skip: query.offset,
        include: {
          _count: { select: { markets: true } },
        },
      });

      return events.map((e) => ({
        id: e.id,
        sportId: e.sportId,
        externalId: e.externalId,
        homeTeam: e.homeTeam,
        awayTeam: e.awayTeam,
        startsAt: e.startsAt.toISOString(),
        status: e.status,
        homeScore: e.homeScore,
        awayScore: e.awayScore,
        marketCount: e._count.markets,
      }));
    });

    fastify.post<{ Params: { id: string } }>('/events/:id/finalize', async (req) => {
      const { homeScore, awayScore } = FinalizeEventSchema.parse(req.body);
      const event = await prisma.event.update({
        where: { id: req.params.id },
        data: { status: 'FINAL', homeScore, awayScore, resolvedAt: new Date() },
      });

      const markets = await prisma.market.findMany({
        where: { eventId: event.id, status: { in: ['OPEN', 'CLOSED'] } },
      });

      const resolved: Array<{ marketId: string; outcome: string }> = [];
      for (const market of markets) {
        const outcome = computeOutcome(market, event);
        const result = await resolveMarket(prisma, market.id, outcome);
        await publishLifecycleEffects(
          bus,
          prisma,
          engineCtx,
          market.id,
          result.payouts.map((p) => p.userId),
        );
        resolved.push({ marketId: market.id, outcome });
      }

      return {
        event: {
          id: event.id,
          homeScore: event.homeScore,
          awayScore: event.awayScore,
          status: event.status,
        },
        resolved,
      };
    });

    // ─── Users ────────────────────────────────────────────────────────────
    fastify.get('/users', async (req) => {
      const query = PaginationSchema.parse(req.query);
      const users = await prisma.user.findMany({
        orderBy: { createdAt: 'desc' },
        take: query.limit,
        skip: query.offset,
        include: { wallet: true },
      });
      return users.map((u) => ({
        id: u.id,
        email: u.email,
        username: u.username,
        isAdmin: u.isAdmin,
        createdAt: u.createdAt.toISOString(),
        wallet: u.wallet
          ? { balance: u.wallet.balance, reserved: u.wallet.reserved }
          : null,
      }));
    });

    fastify.post<{ Params: { id: string } }>('/users/:id/topup', async (req) => {
      const { amount } = TopupSchema.parse(req.body);
      const wallet = await prisma.wallet.findUnique({ where: { userId: req.params.id } });
      if (!wallet) {
        throw new HttpError(404, 'NOT_FOUND', 'Wallet not found');
      }
      // Disallow making the balance go negative.
      if (wallet.balance + amount < 0) {
        throw new HttpError(
          409,
          'INSUFFICIENT_BALANCE',
          `Topup of ${amount} would drop balance below zero (current ${wallet.balance})`,
        );
      }
      const updated = await prisma.wallet.update({
        where: { userId: req.params.id },
        data: { balance: { increment: amount } },
      });
      await bus.publishWallet(req.params.id, updated);
      return {
        wallet: {
          userId: req.params.id,
          balance: updated.balance,
          reserved: updated.reserved,
        },
      };
    });
  };
}

type Outcome = 'YES' | 'NO' | 'INVALID';

/**
 * Mirror of resolver/src/pricing.ts:computeOutcome. Inlined to avoid an
 * api → resolver dependency edge for one tiny helper.
 */
function computeOutcome(
  market: { type: string; line: number | null },
  event: { homeScore: number | null; awayScore: number | null },
): Outcome {
  const { homeScore, awayScore } = event;
  if (homeScore == null || awayScore == null) return 'INVALID';

  if (market.type === 'MONEYLINE') {
    if (homeScore > awayScore) return 'YES';
    if (homeScore < awayScore) return 'NO';
    return 'INVALID';
  }
  if (market.type === 'TOTAL') {
    if (market.line == null) return 'INVALID';
    const combined = homeScore + awayScore;
    if (combined > market.line) return 'YES';
    if (combined < market.line) return 'NO';
    return 'INVALID';
  }
  if (market.type === 'SPREAD') {
    if (market.line == null) return 'INVALID';
    const diff = homeScore - awayScore;
    if (diff > market.line) return 'YES';
    if (diff < market.line) return 'NO';
    return 'INVALID';
  }
  return 'INVALID';
}

function serializeMarket(m: {
  id: string;
  type: string;
  question: string;
  line: number | null;
  status: string;
  outcome: string | null;
  closedAt: Date | null;
  resolvedAt: Date | null;
  eventId: string;
}) {
  return {
    id: m.id,
    type: m.type,
    question: m.question,
    line: m.line,
    status: m.status,
    outcome: m.outcome,
    closedAt: m.closedAt?.toISOString() ?? null,
    resolvedAt: m.resolvedAt?.toISOString() ?? null,
    eventId: m.eventId,
  };
}
