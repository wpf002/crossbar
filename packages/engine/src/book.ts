import type { OrderBookSnapshot, OrderBookLevel } from '@crossbar/shared';
import { SHARE_PAYOUT } from '@crossbar/shared';

export type Side = 'BUY' | 'SELL';
export type OutcomeSide = 'YES' | 'NO';

export interface BookOrder {
  id: string;
  userId: string;
  side: Side;
  outcome: OutcomeSide;
  price: number;
  remaining: number;
  ts: number; // insertion time, monotonic
}

/**
 * One candidate yielded by `iterateMatches`. `execPrice` is the price the
 * incoming taker would pay/receive if matched against this resting order
 * (the resting order's price always wins; on a cross-match the taker price
 * is 100 − resting.price).
 */
export interface MatchCandidate {
  order: BookOrder;
  /** 'direct' = same outcome, opposite side; 'cross' = opposite outcome, both buys */
  kind: 'direct' | 'cross';
  /** What the incoming order will pay (BUY) or receive (SELL) per share */
  takerExecPrice: number;
}

/** A FIFO queue of orders sharing a price. */
interface PriceLevel {
  price: number;
  orders: BookOrder[];
}

class OutcomeBook {
  /** Descending by price — `bids[0]` is the best bid. */
  bids: PriceLevel[] = [];
  /** Ascending by price — `asks[0]` is the best ask. */
  asks: PriceLevel[] = [];
}

export class OrderBook {
  readonly marketId: string;
  private yes = new OutcomeBook();
  private no = new OutcomeBook();
  private byId = new Map<string, { outcome: OutcomeSide; side: Side; price: number }>();

  constructor(marketId: string) {
    this.marketId = marketId;
  }

  addOrder(order: BookOrder): void {
    if (this.byId.has(order.id)) return;
    const ob = order.outcome === 'YES' ? this.yes : this.no;
    const levels = order.side === 'BUY' ? ob.bids : ob.asks;
    const descending = order.side === 'BUY';
    insertIntoLevels(levels, order, descending);
    this.byId.set(order.id, {
      outcome: order.outcome,
      side: order.side,
      price: order.price,
    });
  }

  removeOrder(orderId: string): boolean {
    const meta = this.byId.get(orderId);
    if (!meta) return false;
    const ob = meta.outcome === 'YES' ? this.yes : this.no;
    const levels = meta.side === 'BUY' ? ob.bids : ob.asks;
    const idx = levels.findIndex((l) => l.price === meta.price);
    if (idx === -1) {
      this.byId.delete(orderId);
      return false;
    }
    const level = levels[idx]!;
    const orderIdx = level.orders.findIndex((o) => o.id === orderId);
    if (orderIdx !== -1) level.orders.splice(orderIdx, 1);
    if (level.orders.length === 0) levels.splice(idx, 1);
    this.byId.delete(orderId);
    return true;
  }

  /** Decrement the remaining quantity of an order; remove if it hits zero. */
  decrementOrder(orderId: string, qty: number): void {
    const meta = this.byId.get(orderId);
    if (!meta) return;
    const ob = meta.outcome === 'YES' ? this.yes : this.no;
    const levels = meta.side === 'BUY' ? ob.bids : ob.asks;
    const level = levels.find((l) => l.price === meta.price);
    if (!level) return;
    const order = level.orders.find((o) => o.id === orderId);
    if (!order) return;
    order.remaining -= qty;
    if (order.remaining <= 0) this.removeOrder(orderId);
  }

  bestBid(outcome: OutcomeSide): number | undefined {
    const ob = outcome === 'YES' ? this.yes : this.no;
    return ob.bids[0]?.price;
  }

  bestAsk(outcome: OutcomeSide): number | undefined {
    const ob = outcome === 'YES' ? this.yes : this.no;
    return ob.asks[0]?.price;
  }

  snapshot(): OrderBookSnapshot {
    return {
      marketId: this.marketId,
      yesBids: aggregateLevels(this.yes.bids),
      yesAsks: aggregateLevels(this.yes.asks),
      noBids: aggregateLevels(this.no.bids),
      noAsks: aggregateLevels(this.no.asks),
    };
  }

  /**
   * Yields matches in priority order (best taker execution price first;
   * FIFO within tie). The caller decides when to stop iterating.
   *
   * For a BUY taker: direct candidates are resting SELL on same outcome with
   * price ≤ limitPrice; cross candidates are resting BUY on opposite outcome
   * with price ≥ (100 − limitPrice).
   *
   * For a SELL taker: direct candidates are resting BUY on same outcome with
   * price ≥ limitPrice. No cross-side matches (cross-matches mint pairs;
   * SELLs decrement existing positions instead).
   */
  *iterateMatches(side: Side, outcome: OutcomeSide, limitPrice: number): Generator<MatchCandidate> {
    if (side === 'BUY') {
      const sameOb = outcome === 'YES' ? this.yes : this.no;
      const oppOb = outcome === 'YES' ? this.no : this.yes;
      const directIter = walkAsks(sameOb.asks, limitPrice);
      const crossIter = walkBids(oppOb.bids, SHARE_PAYOUT - limitPrice);

      yield* mergeBuyCandidates(directIter, crossIter);
    } else {
      const sameOb = outcome === 'YES' ? this.yes : this.no;
      yield* walkBidsForSell(sameOb.bids, limitPrice);
    }
  }
}

function insertIntoLevels(levels: PriceLevel[], order: BookOrder, descending: boolean): void {
  for (let i = 0; i < levels.length; i++) {
    const level = levels[i]!;
    if (level.price === order.price) {
      level.orders.push(order);
      return;
    }
    if (descending ? order.price > level.price : order.price < level.price) {
      levels.splice(i, 0, { price: order.price, orders: [order] });
      return;
    }
  }
  levels.push({ price: order.price, orders: [order] });
}

function aggregateLevels(levels: PriceLevel[]): OrderBookLevel[] {
  return levels.map((l) => ({
    price: l.price,
    quantity: l.orders.reduce((acc, o) => acc + o.remaining, 0),
  }));
}

function* walkAsks(asks: PriceLevel[], maxPrice: number): Generator<MatchCandidate> {
  for (const level of asks) {
    if (level.price > maxPrice) return;
    for (const order of level.orders) {
      yield { order, kind: 'direct', takerExecPrice: order.price };
    }
  }
}

function* walkBids(bids: PriceLevel[], minPrice: number): Generator<MatchCandidate> {
  for (const level of bids) {
    if (level.price < minPrice) return;
    for (const order of level.orders) {
      yield {
        order,
        kind: 'cross',
        takerExecPrice: SHARE_PAYOUT - order.price,
      };
    }
  }
}

function* walkBidsForSell(bids: PriceLevel[], minPrice: number): Generator<MatchCandidate> {
  for (const level of bids) {
    if (level.price < minPrice) return;
    for (const order of level.orders) {
      yield { order, kind: 'direct', takerExecPrice: order.price };
    }
  }
}

/**
 * Merge two candidate streams for a BUY taker — yield the candidate with the
 * cheaper taker exec price next; tie-break by earlier insertion timestamp.
 */
function* mergeBuyCandidates(
  a: Generator<MatchCandidate>,
  b: Generator<MatchCandidate>,
): Generator<MatchCandidate> {
  let nextA = a.next();
  let nextB = b.next();

  while (!nextA.done && !nextB.done) {
    const ca = nextA.value;
    const cb = nextB.value;
    const pickA =
      ca.takerExecPrice < cb.takerExecPrice ||
      (ca.takerExecPrice === cb.takerExecPrice && ca.order.ts <= cb.order.ts);
    if (pickA) {
      yield ca;
      nextA = a.next();
    } else {
      yield cb;
      nextB = b.next();
    }
  }
  while (!nextA.done) {
    yield nextA.value;
    nextA = a.next();
  }
  while (!nextB.done) {
    yield nextB.value;
    nextB = b.next();
  }
}
