import type Redis from 'ioredis';
import type { Order, PrismaClient, Trade } from '@prisma/client';
import { PlaceOrderSchema, type PlaceOrderInput, SHARE_PAYOUT } from '@crossbar/shared';
import { ZodError } from 'zod';
import { OrderBook, type BookOrder, type OutcomeSide } from './book.js';
import {
  executeCrossTrade,
  executeDirectTrade,
  type CrossTradeInput,
  type DirectTradeInput,
} from './settlement.js';
import { addToBook, decrementBook, removeFromBookByLocation } from './redis-book.js';
import {
  InsufficientFundsError,
  InsufficientPositionError,
  InvalidOrderError,
  MarketNotOpenError,
  OrderNotFoundError,
} from './errors.js';

export interface EngineContext {
  prisma: PrismaClient;
  redis?: Redis;
  /** marketId → in-memory book. Created lazily if missing. */
  books: Map<string, OrderBook>;
}

export interface PlaceOrderResult {
  order: Order;
  fills: Trade[];
}

/**
 * Place a new limit order. Validates, reserves funds/shares, walks the book,
 * settles every match atomically, and rests any leftover quantity.
 */
export async function placeOrder(
  rawInput: unknown,
  userId: string,
  ctx: EngineContext,
): Promise<PlaceOrderResult> {
  let input: PlaceOrderInput;
  try {
    input = PlaceOrderSchema.parse(rawInput);
  } catch (err) {
    if (err instanceof ZodError) {
      throw new InvalidOrderError(err.issues.map((i) => i.message).join('; '));
    }
    throw err;
  }

  const market = await ctx.prisma.market.findUnique({
    where: { id: input.marketId },
    select: { id: true, status: true },
  });
  if (!market) throw new InvalidOrderError(`Market ${input.marketId} not found`);
  if (market.status !== 'OPEN') throw new MarketNotOpenError();

  await assertEligible(ctx.prisma, userId, input);

  // Create the order row & reserve funds in one transaction so we never have
  // a half-state where a row exists but funds aren't reserved.
  const order = await ctx.prisma.$transaction(async (tx) => {
    if (input.side === 'BUY') {
      const cost = input.price * input.quantity;
      const wallet = await tx.wallet.findUniqueOrThrow({ where: { userId } });
      if (wallet.balance < cost) {
        throw new InsufficientFundsError();
      }
      await tx.wallet.update({
        where: { userId },
        data: {
          balance: { decrement: cost },
          reserved: { increment: cost },
        },
      });
    }
    return tx.order.create({
      data: {
        marketId: input.marketId,
        userId,
        side: input.side,
        outcome: input.outcome,
        price: input.price,
        quantity: input.quantity,
      },
    });
  });

  const book = getOrCreateBook(ctx, input.marketId);
  const fills: Trade[] = [];
  let remaining = order.quantity;
  const ts = order.createdAt.getTime();

  // We need to materialise the iterator into a list because we mutate the
  // book as we go (decrementOrder / removeOrder), which would invalidate a
  // live generator.
  const candidates = [...book.iterateMatches(input.side, input.outcome, input.price)].filter(
    (c) => c.order.userId !== userId,
  );

  for (const candidate of candidates) {
    if (remaining === 0) break;
    // Re-check remaining on the resting order — if a prior iteration filled it.
    if (candidate.order.remaining <= 0) continue;

    const fillQty = Math.min(remaining, candidate.order.remaining);

    if (candidate.kind === 'direct') {
      const direct: DirectTradeInput =
        input.side === 'BUY'
          ? {
              marketId: input.marketId,
              outcome: input.outcome,
              quantity: fillQty,
              buyerBidPrice: input.price,
              execPrice: candidate.order.price,
              buyer: { userId, orderId: order.id },
              seller: {
                userId: candidate.order.userId,
                orderId: candidate.order.id,
              },
            }
          : {
              marketId: input.marketId,
              outcome: input.outcome,
              quantity: fillQty,
              // Resting buyer's price was their bid; release that reservation.
              buyerBidPrice: candidate.order.price,
              execPrice: candidate.order.price,
              buyer: {
                userId: candidate.order.userId,
                orderId: candidate.order.id,
              },
              seller: { userId, orderId: order.id },
            };

      const trade = await executeDirectTrade(ctx.prisma, direct);
      fills.push(trade);
    } else {
      // cross — only possible when incoming is BUY (book.ts enforces this).
      const yesIsIncoming = input.outcome === 'YES';
      const cross: CrossTradeInput = {
        marketId: input.marketId,
        quantity: fillQty,
        yesBuyer: yesIsIncoming
          ? {
              userId,
              orderId: order.id,
              bidPrice: input.price,
              execPrice: SHARE_PAYOUT - candidate.order.price,
            }
          : {
              userId: candidate.order.userId,
              orderId: candidate.order.id,
              bidPrice: candidate.order.price,
              execPrice: candidate.order.price,
            },
        noBuyer: yesIsIncoming
          ? {
              userId: candidate.order.userId,
              orderId: candidate.order.id,
              bidPrice: candidate.order.price,
              execPrice: candidate.order.price,
            }
          : {
              userId,
              orderId: order.id,
              bidPrice: input.price,
              execPrice: SHARE_PAYOUT - candidate.order.price,
            },
      };
      const { yesTrade, noTrade } = await executeCrossTrade(ctx.prisma, cross);
      fills.push(yesTrade, noTrade);
    }

    // Mirror book updates: in-memory + Redis (if connected).
    const restingId = candidate.order.id;
    const newRestingRemaining = candidate.order.remaining - fillQty;
    const restingOutcome = candidate.order.outcome;
    const restingSide = candidate.order.side;
    const restingPrice = candidate.order.price;
    const restingTs = candidate.order.ts;
    const oldRestingRemaining = candidate.order.remaining;

    book.decrementOrder(restingId, fillQty);
    if (ctx.redis) {
      await decrementBook(
        ctx.redis,
        input.marketId,
        restingOutcome,
        restingSide,
        restingId,
        newRestingRemaining,
        restingPrice,
        restingTs,
        oldRestingRemaining,
      );
    }

    remaining -= fillQty;
  }

  // Rest any leftover quantity. Note: status was set per fill by settlement,
  // so we re-load to get the final state, then transition OPEN→PARTIAL if
  // needed (full fill is already FILLED via bumpOrderFill).
  const finalOrder = await ctx.prisma.order.findUniqueOrThrow({
    where: { id: order.id },
  });

  if (remaining > 0) {
    const entry: BookOrder = {
      id: finalOrder.id,
      userId,
      side: input.side,
      outcome: input.outcome,
      price: input.price,
      remaining,
      ts,
    };
    book.addOrder(entry);
    if (ctx.redis) {
      await addToBook(ctx.redis, input.marketId, entry);
    }
  }

  return { order: finalOrder, fills };
}

/**
 * Cancel an OPEN/PARTIAL order. Returns reserved funds to balance (BUY) and
 * removes from the book. SELLs hold no reservation; they're simply removed.
 */
export async function cancelOrder(
  orderId: string,
  userId: string,
  ctx: EngineContext,
): Promise<Order> {
  const order = await ctx.prisma.order.findUnique({ where: { id: orderId } });
  if (!order) throw new OrderNotFoundError(orderId);
  if (order.userId !== userId) throw new OrderNotFoundError(orderId);
  if (order.status === 'FILLED' || order.status === 'CANCELED') {
    return order;
  }

  const unfilled = order.quantity - order.filled;

  const updated = await ctx.prisma.$transaction(async (tx) => {
    if (order.side === 'BUY' && unfilled > 0) {
      const release = order.price * unfilled;
      await tx.wallet.update({
        where: { userId },
        data: {
          reserved: { decrement: release },
          balance: { increment: release },
        },
      });
    }
    return tx.order.update({
      where: { id: orderId },
      data: { status: 'CANCELED' },
    });
  });

  const book = getOrCreateBook(ctx, order.marketId);
  book.removeOrder(orderId);
  if (ctx.redis) {
    await removeFromBookByLocation(
      ctx.redis,
      order.marketId,
      order.outcome as OutcomeSide,
      order.side,
      orderId,
    );
  }

  return updated;
}

function getOrCreateBook(ctx: EngineContext, marketId: string): OrderBook {
  let book = ctx.books.get(marketId);
  if (!book) {
    book = new OrderBook(marketId);
    ctx.books.set(marketId, book);
  }
  return book;
}

async function assertEligible(
  prisma: PrismaClient,
  userId: string,
  input: PlaceOrderInput,
): Promise<void> {
  if (input.side === 'BUY') {
    const wallet = await prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) throw new InsufficientFundsError('Wallet not found');
    const cost = input.price * input.quantity;
    if (wallet.balance < cost) {
      throw new InsufficientFundsError(`Need ${cost}¢ available, wallet has ${wallet.balance}¢`);
    }
    return;
  }

  // SELL — must own the shares net of any already-reserved-in-open-sells.
  const position = await prisma.position.findUnique({
    where: { userId_marketId: { userId, marketId: input.marketId } },
  });
  const owned = input.outcome === 'YES' ? (position?.yesShares ?? 0) : (position?.noShares ?? 0);

  const openSells = await prisma.order.findMany({
    where: {
      userId,
      marketId: input.marketId,
      outcome: input.outcome,
      side: 'SELL',
      status: { in: ['OPEN', 'PARTIAL'] },
    },
    select: { quantity: true, filled: true },
  });
  const reservedShares = openSells.reduce((a, o) => a + (o.quantity - o.filled), 0);

  const available = owned - reservedShares;
  if (available < input.quantity) {
    throw new InsufficientPositionError(
      `Need ${input.quantity} ${input.outcome} shares available, have ${available}`,
    );
  }
}
