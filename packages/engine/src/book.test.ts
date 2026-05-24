import { describe, it, expect } from 'vitest';
import { OrderBook, type BookOrder } from './book.js';

function mk(partial: Partial<BookOrder> & { id: string }): BookOrder {
  return {
    userId: 'u1',
    side: 'BUY',
    outcome: 'YES',
    price: 50,
    remaining: 10,
    ts: Date.now(),
    ...partial,
  };
}

describe('OrderBook', () => {
  it('returns undefined best-bid/ask for empty book', () => {
    const b = new OrderBook('m1');
    expect(b.bestBid('YES')).toBeUndefined();
    expect(b.bestAsk('YES')).toBeUndefined();
    expect(b.bestBid('NO')).toBeUndefined();
    expect(b.bestAsk('NO')).toBeUndefined();
  });

  it('add/best-bid/best-ask reflect inserted orders', () => {
    const b = new OrderBook('m1');
    b.addOrder(mk({ id: 'o1', side: 'BUY', outcome: 'YES', price: 40 }));
    b.addOrder(mk({ id: 'o2', side: 'BUY', outcome: 'YES', price: 50 }));
    b.addOrder(mk({ id: 'o3', side: 'SELL', outcome: 'YES', price: 60 }));
    b.addOrder(mk({ id: 'o4', side: 'SELL', outcome: 'YES', price: 70 }));

    expect(b.bestBid('YES')).toBe(50);
    expect(b.bestAsk('YES')).toBe(60);
  });

  it('removing an unknown order is a no-op', () => {
    const b = new OrderBook('m1');
    b.addOrder(mk({ id: 'o1', price: 50 }));
    expect(b.removeOrder('does-not-exist')).toBe(false);
    expect(b.bestBid('YES')).toBe(50);
  });

  it('removing the only order at a level clears that level', () => {
    const b = new OrderBook('m1');
    b.addOrder(mk({ id: 'o1', price: 50 }));
    b.removeOrder('o1');
    expect(b.bestBid('YES')).toBeUndefined();
    // Snapshot should show no levels.
    expect(b.snapshot().yesBids).toEqual([]);
  });

  it('FIFO order within a price level (price-time priority)', () => {
    const b = new OrderBook('m1');
    b.addOrder(mk({ id: 'first', side: 'SELL', price: 60, ts: 1, remaining: 10 }));
    b.addOrder(mk({ id: 'second', side: 'SELL', price: 60, ts: 2, remaining: 10 }));
    b.addOrder(mk({ id: 'third', side: 'SELL', price: 60, ts: 3, remaining: 10 }));

    const candidates = [...b.iterateMatches('BUY', 'YES', 60)];
    expect(candidates.map((c) => c.order.id)).toEqual(['first', 'second', 'third']);
  });

  it('best price wins across levels', () => {
    const b = new OrderBook('m1');
    b.addOrder(mk({ id: 'high', side: 'SELL', price: 70, ts: 1, remaining: 5 }));
    b.addOrder(mk({ id: 'low', side: 'SELL', price: 55, ts: 2, remaining: 5 }));
    b.addOrder(mk({ id: 'mid', side: 'SELL', price: 60, ts: 3, remaining: 5 }));

    const candidates = [...b.iterateMatches('BUY', 'YES', 80)];
    expect(candidates.map((c) => c.order.id)).toEqual(['low', 'mid', 'high']);
  });

  it('iterateMatches respects taker limit price (direct)', () => {
    const b = new OrderBook('m1');
    b.addOrder(mk({ id: 'in', side: 'SELL', price: 55, ts: 1, remaining: 5 }));
    b.addOrder(mk({ id: 'out', side: 'SELL', price: 65, ts: 2, remaining: 5 }));

    const candidates = [...b.iterateMatches('BUY', 'YES', 60)];
    expect(candidates.map((c) => c.order.id)).toEqual(['in']);
  });

  it('iterateMatches merges cross-side candidates', () => {
    const b = new OrderBook('m1');
    // Resting NO bid at 40 → taker BUY YES @ 70 sees taker exec 60 (cross).
    b.addOrder(mk({ id: 'no-bid', side: 'BUY', outcome: 'NO', price: 40, ts: 1 }));
    // Resting SELL YES at 55 → taker exec 55 (direct, cheaper).
    b.addOrder(mk({ id: 'yes-ask', side: 'SELL', outcome: 'YES', price: 55, ts: 2 }));

    const candidates = [...b.iterateMatches('BUY', 'YES', 70)];
    expect(candidates.map((c) => c.order.id)).toEqual(['yes-ask', 'no-bid']);
    expect(candidates.map((c) => c.takerExecPrice)).toEqual([55, 60]);
    expect(candidates.map((c) => c.kind)).toEqual(['direct', 'cross']);
  });

  it('iterateMatches excludes cross candidates that fail the pair price', () => {
    const b = new OrderBook('m1');
    // BUY NO @ 30 + BUY YES @ 60 = 90 < 100, no cross.
    b.addOrder(mk({ id: 'no-bid', side: 'BUY', outcome: 'NO', price: 30, ts: 1 }));
    const candidates = [...b.iterateMatches('BUY', 'YES', 60)];
    expect(candidates).toEqual([]);
  });

  it('SELL never sees cross candidates', () => {
    const b = new OrderBook('m1');
    b.addOrder(mk({ id: 'no-bid', side: 'BUY', outcome: 'NO', price: 60, ts: 1 }));
    // No resting BUY YES — SELL YES sees nothing.
    const candidates = [...b.iterateMatches('SELL', 'YES', 40)];
    expect(candidates).toEqual([]);
  });

  it('SELL walks bids descending and respects minimum price', () => {
    const b = new OrderBook('m1');
    b.addOrder(mk({ id: 'high', side: 'BUY', outcome: 'YES', price: 70, ts: 1 }));
    b.addOrder(mk({ id: 'mid', side: 'BUY', outcome: 'YES', price: 60, ts: 2 }));
    b.addOrder(mk({ id: 'low', side: 'BUY', outcome: 'YES', price: 45, ts: 3 }));

    const candidates = [...b.iterateMatches('SELL', 'YES', 60)];
    expect(candidates.map((c) => c.order.id)).toEqual(['high', 'mid']);
  });

  it('snapshot aggregates by price level', () => {
    const b = new OrderBook('m1');
    b.addOrder(mk({ id: 'a', side: 'BUY', outcome: 'YES', price: 50, remaining: 10, ts: 1 }));
    b.addOrder(mk({ id: 'b', side: 'BUY', outcome: 'YES', price: 50, remaining: 25, ts: 2 }));
    b.addOrder(mk({ id: 'c', side: 'BUY', outcome: 'YES', price: 45, remaining: 5, ts: 3 }));

    const snap = b.snapshot();
    expect(snap.yesBids).toEqual([
      { price: 50, quantity: 35 },
      { price: 45, quantity: 5 },
    ]);
  });

  it('decrementOrder reduces remaining and removes at zero', () => {
    const b = new OrderBook('m1');
    b.addOrder(mk({ id: 'x', price: 60, remaining: 10 }));
    b.decrementOrder('x', 4);
    expect(b.snapshot().yesBids[0]?.quantity).toBe(6);
    b.decrementOrder('x', 6);
    expect(b.bestBid('YES')).toBeUndefined();
  });
});
