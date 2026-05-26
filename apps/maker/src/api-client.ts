/**
 * Thin HTTP client wrapping the Crossbar API. Bots authenticate via JWT and
 * place orders just like real users — same rate limits, same validation,
 * same audit trail. There is intentionally no shortcut into the engine.
 */

import type { Logger } from 'pino';

interface ApiOpts {
  baseUrl: string;
  log: Logger;
}

export interface SignupBody {
  email: string;
  username: string;
  password: string;
}

export interface AuthResponse {
  user: { id: string; email: string; username: string };
  token: string;
}

export interface MarketSummary {
  id: string;
  type: 'MONEYLINE' | 'TOTAL' | 'SPREAD';
  line: number | null;
  status: 'OPEN' | 'CLOSED' | 'RESOLVED' | 'VOIDED';
  event: {
    id: string;
    sportId: string;
    homeTeam: string;
    awayTeam: string;
    startsAt: string;
    status: 'SCHEDULED' | 'LIVE' | 'FINAL' | 'POSTPONED' | 'CANCELED';
  };
  topOfBook: {
    yesBid: number | null;
    yesAsk: number | null;
    noBid: number | null;
    noAsk: number | null;
  };
  lastTradePrice: number | null;
  volume24h?: number;
}

export interface Trade {
  id: string;
  marketId: string;
  outcome: 'YES' | 'NO';
  price: number;
  quantity: number;
  buyerUserId: string;
  sellerUserId: string;
  createdAt: string;
}

export interface MyOrder {
  id: string;
  marketId: string;
  side: 'BUY' | 'SELL';
  outcome: 'YES' | 'NO';
  price: number;
  quantity: number;
  filled: number;
  status: 'OPEN' | 'PARTIAL' | 'FILLED' | 'CANCELED';
}

export class ApiClient {
  private base: string;
  private log: Logger;

  constructor(opts: ApiOpts) {
    this.base = opts.baseUrl.replace(/\/$/, '');
    this.log = opts.log;
  }

  async signupOrLogin(body: SignupBody): Promise<AuthResponse> {
    const signup = await fetch(`${this.base}/auth/signup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (signup.ok) return (await signup.json()) as AuthResponse;
    if (signup.status === 409) {
      // Already exists — log in instead.
      const login = await fetch(`${this.base}/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: body.email, password: body.password }),
      });
      if (!login.ok) {
        const text = await login.text();
        throw new Error(`login failed for ${body.email}: ${login.status} ${text}`);
      }
      return (await login.json()) as AuthResponse;
    }
    const text = await signup.text();
    throw new Error(`signup failed for ${body.email}: ${signup.status} ${text}`);
  }

  async listMarkets(): Promise<MarketSummary[]> {
    const res = await fetch(`${this.base}/markets`);
    if (!res.ok) throw new Error(`listMarkets: ${res.status}`);
    return (await res.json()) as MarketSummary[];
  }

  async marketTrades(marketId: string, limit = 20): Promise<{ trades: Trade[] }> {
    const res = await fetch(`${this.base}/markets/${marketId}/trades?limit=${limit}`);
    if (!res.ok) throw new Error(`marketTrades: ${res.status}`);
    return (await res.json()) as { trades: Trade[] };
  }

  async myOrders(token: string): Promise<{ orders: MyOrder[] }> {
    const res = await fetch(`${this.base}/me/orders?status=OPEN,PARTIAL&limit=200`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`myOrders: ${res.status}`);
    return (await res.json()) as { orders: MyOrder[] };
  }

  async placeOrder(
    token: string,
    input: {
      marketId: string;
      side: 'BUY' | 'SELL';
      outcome: 'YES' | 'NO';
      price: number;
      quantity: number;
    },
  ): Promise<void> {
    const res = await fetch(`${this.base}/orders`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      const text = await res.text();
      // Common rejections (insufficient funds, market closed) are fine — just
      // skip and try again next tick.
      this.log.debug({ status: res.status, body: text, input }, 'placeOrder rejected');
      throw new ApiError(res.status, text);
    }
  }

  async cancelOrder(token: string, orderId: string): Promise<void> {
    const res = await fetch(`${this.base}/orders/${orderId}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${token}` },
    });
    if (!res.ok && res.status !== 404) {
      throw new ApiError(res.status, await res.text());
    }
  }
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(`${status}: ${message}`);
    this.status = status;
  }
}
