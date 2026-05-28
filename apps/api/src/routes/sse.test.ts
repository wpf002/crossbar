import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { bearer, makeApp, makeOpenMarket, signupUser } from '../test-helpers.js';

let app: FastifyInstance;
let baseUrl: string;

beforeAll(async () => {
  app = await makeApp({ withRedis: true });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address();
  if (!addr || typeof addr === 'string') throw new Error('no address');
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await app.close();
});

/**
 * Parse a Node fetch response body as a stream of SSE messages. Yields each
 * `event:` block as `{ event, data }` until the underlying stream ends.
 */
async function* readSse(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): AsyncGenerator<{ event: string; data: string }> {
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) return;
    buf += decoder.decode(value, { stream: true });
    while (true) {
      const idx = buf.indexOf('\n\n');
      if (idx === -1) break;
      const block = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      let event = 'message';
      const dataLines: string[] = [];
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
      }
      if (dataLines.length === 0) continue; // skip comments / pings
      yield { event, data: dataLines.join('\n') };
    }
  }
}

interface SseClient {
  events: Array<{ event: string; data: string }>;
  close(): void;
  /** Resolve when the next event matching `pred` arrives, or reject after `timeoutMs`. */
  waitFor(pred: (e: { event: string }) => boolean, timeoutMs?: number): Promise<{ event: string; data: string }>;
}

function openSseClient(url: string, headers: Record<string, string> = {}): Promise<SseClient> {
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    const events: Array<{ event: string; data: string }> = [];
    const waiters: Array<{
      pred: (e: { event: string }) => boolean;
      resolve: (e: { event: string; data: string }) => void;
    }> = [];

    fetch(url, { signal: controller.signal, headers })
      .then(async (res) => {
        if (!res.ok || !res.body) {
          reject(new Error(`SSE open failed: ${res.status}`));
          return;
        }
        const reader = res.body.getReader();

        const client: SseClient = {
          events,
          close: () => controller.abort(),
          waitFor: (pred, timeoutMs = 5000) =>
            new Promise((resolveEvt, rejectEvt) => {
              const existing = events.find(pred);
              if (existing) {
                resolveEvt(existing);
                return;
              }
              const timer = setTimeout(() => {
                rejectEvt(new Error(`SSE wait timed out (${timeoutMs}ms)`));
              }, timeoutMs);
              waiters.push({
                pred,
                resolve: (e) => {
                  clearTimeout(timer);
                  resolveEvt(e);
                },
              });
            }),
        };
        resolve(client);

        (async () => {
          try {
            for await (const evt of readSse(reader)) {
              events.push(evt);
              for (let i = waiters.length - 1; i >= 0; i--) {
                if (waiters[i]!.pred(evt)) {
                  waiters[i]!.resolve(evt);
                  waiters.splice(i, 1);
                }
              }
            }
          } catch {
            // closed by abort or remote disconnect
          }
        })().catch(() => undefined);
      })
      .catch((err) => reject(err));
  });
}

describe('GET /sse/markets/:id', () => {
  it('streams a trade event after a fill', async () => {
    const yesBuyer = await signupUser(app);
    const noBuyer = await signupUser(app);
    const marketId = await makeOpenMarket();

    const client = await openSseClient(`${baseUrl}/sse/markets/${marketId}`);
    // Wait for the initial book snapshot so we know we're subscribed.
    await client.waitFor((e) => e.event === 'book');

    // Trigger a cross-trade: BUY YES @ 60 + BUY NO @ 40
    await app.inject({
      method: 'POST',
      url: '/orders',
      headers: bearer(yesBuyer.token),
      payload: { marketId, side: 'BUY', outcome: 'YES', price: 60, quantity: 5 },
    });
    await app.inject({
      method: 'POST',
      url: '/orders',
      headers: bearer(noBuyer.token),
      payload: { marketId, side: 'BUY', outcome: 'NO', price: 40, quantity: 5 },
    });

    const tradeEvt = await client.waitFor((e) => e.event === 'trade');
    const trade = JSON.parse(tradeEvt.data) as { price: number; quantity: number };
    expect(trade.quantity).toBe(5);
    expect([40, 60]).toContain(trade.price);

    client.close();
  });

  it('returns 404 for an unknown market', async () => {
    const res = await fetch(`${baseUrl}/sse/markets/does-not-exist`);
    expect(res.status).toBe(404);
  });

  it('sends a first-connect book snapshot read from Redis (post-cutover)', async () => {
    const user = await signupUser(app);
    const marketId = await makeOpenMarket();

    // Rest a bid through the matcher so it writes the snapshot key.
    await app.inject({
      method: 'POST',
      url: '/orders',
      headers: bearer(user.token),
      payload: { marketId, side: 'BUY', outcome: 'YES', price: 60, quantity: 7 },
    });

    const client = await openSseClient(`${baseUrl}/sse/markets/${marketId}`);
    const bookEvt = await client.waitFor((e) => e.event === 'book');
    const book = JSON.parse(bookEvt.data) as { yesBids: Array<{ price: number; quantity: number }> };
    expect(book.yesBids[0]?.price).toBe(60);
    expect(book.yesBids[0]?.quantity).toBe(7);

    client.close();
  });
});

describe('GET /sse/me', () => {
  it('requires a token', async () => {
    const res = await fetch(`${baseUrl}/sse/me`);
    expect(res.status).toBe(401);
  });

  it('rejects an invalid token', async () => {
    const res = await fetch(`${baseUrl}/sse/me?token=not-a-jwt`);
    expect(res.status).toBe(401);
  });

  it('streams wallet updates when the user trades', async () => {
    const user = await signupUser(app);
    const counterparty = await signupUser(app);
    const marketId = await makeOpenMarket();

    const client = await openSseClient(`${baseUrl}/sse/me?token=${user.token}`);

    // Place a buy that crosses with the counterparty for a guaranteed fill.
    await app.inject({
      method: 'POST',
      url: '/orders',
      headers: bearer(counterparty.token),
      payload: { marketId, side: 'BUY', outcome: 'NO', price: 40, quantity: 5 },
    });
    await app.inject({
      method: 'POST',
      url: '/orders',
      headers: bearer(user.token),
      payload: { marketId, side: 'BUY', outcome: 'YES', price: 60, quantity: 5 },
    });

    const walletEvt = await client.waitFor((e) => e.event === 'wallet');
    const wallet = JSON.parse(walletEvt.data) as { balance: number };
    // Spent 60 * 5 = 300¢
    expect(wallet.balance).toBe(100_000 - 300);

    const orderEvt = await client.waitFor((e) => e.event === 'order');
    const order = JSON.parse(orderEvt.data) as { status: string };
    expect(['FILLED', 'PARTIAL']).toContain(order.status);

    client.close();
  });
});

describe('GET /sse/markets (lastTrade stream)', () => {
  it('emits a lastTrade event for any market', async () => {
    const yesBuyer = await signupUser(app);
    const noBuyer = await signupUser(app);
    const marketId = await makeOpenMarket();

    const client = await openSseClient(`${baseUrl}/sse/markets`);
    // The endpoint sends a "subscribed" comment immediately — wait a beat for
    // the subscription to take effect by sending a tiny sleep.
    await new Promise((r) => setTimeout(r, 50));

    await app.inject({
      method: 'POST',
      url: '/orders',
      headers: bearer(yesBuyer.token),
      payload: { marketId, side: 'BUY', outcome: 'YES', price: 60, quantity: 3 },
    });
    await app.inject({
      method: 'POST',
      url: '/orders',
      headers: bearer(noBuyer.token),
      payload: { marketId, side: 'BUY', outcome: 'NO', price: 40, quantity: 3 },
    });

    const evt = await client.waitFor((e) => e.event === 'lastTrade');
    const payload = JSON.parse(evt.data) as { marketId: string; price: number };
    expect(payload.marketId).toBe(marketId);
    expect([40, 60]).toContain(payload.price);

    client.close();
  });
});
