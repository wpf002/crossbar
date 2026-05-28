import Cookies from 'js-cookie';
import type {
  BotsStatsResponse,
  CalibrationResponse,
  CandleSeries,
  Comment,
  DailyAccuracyResponse,
  LeaderboardResponse,
  MarketDetail,
  MarketListItem,
  Order,
  OrderBookSnapshot,
  PlaceOrderRequest,
  PlaceOrderResponse,
  Position,
  PublicUser,
  SportId,
  Trade,
  Wallet,
} from './types';

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
export const TOKEN_COOKIE = 'crossbar_token';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function request<T>(
  path: string,
  init: RequestInit & { json?: unknown; auth?: boolean } = {},
): Promise<T> {
  const { json, auth, headers, ...rest } = init;
  const finalHeaders: Record<string, string> = {
    Accept: 'application/json',
    ...((headers as Record<string, string> | undefined) ?? {}),
  };
  if (json !== undefined) {
    finalHeaders['Content-Type'] = 'application/json';
  }
  if (auth) {
    const token = Cookies.get(TOKEN_COOKIE);
    if (token) finalHeaders.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    ...rest,
    headers: finalHeaders,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });

  if (!res.ok) {
    let body: { error?: string; message?: string } = {};
    try {
      body = (await res.json()) as { error?: string; message?: string };
    } catch {
      /* non-JSON error */
    }
    throw new ApiError(
      res.status,
      body.error ?? `HTTP_${res.status}`,
      body.message ?? `Request failed: ${res.status}`,
    );
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// ─── Auth ─────────────────────────────────────────────────────────────────
export interface AuthResponse {
  user: PublicUser;
  token: string;
}

export const api = {
  signup: (body: { email: string; username: string; password: string }) =>
    request<AuthResponse>('/auth/signup', { method: 'POST', json: body }),

  login: (body: { email: string; password: string }) =>
    request<AuthResponse>('/auth/login', { method: 'POST', json: body }),

  me: () => request<PublicUser>('/me', { auth: true }),

  wallet: () => request<Wallet>('/me/wallet', { auth: true }),

  positions: () => request<Position[]>('/me/positions', { auth: true }),

  myOrders: (opts: { status?: string; limit?: number; offset?: number } = {}) => {
    const params = new URLSearchParams();
    if (opts.status) params.set('status', opts.status);
    if (opts.limit != null) params.set('limit', String(opts.limit));
    if (opts.offset != null) params.set('offset', String(opts.offset));
    const qs = params.toString();
    return request<{ orders: Order[]; limit: number; offset: number }>(
      `/me/orders${qs ? `?${qs}` : ''}`,
      { auth: true },
    );
  },

  equity: (opts: { hours?: number } = {}) => {
    const params = new URLSearchParams();
    if (opts.hours != null) params.set('hours', String(opts.hours));
    const qs = params.toString();
    return request<{ points: Array<{ ts: string; equity: number }> }>(
      `/me/equity${qs ? `?${qs}` : ''}`,
      { auth: true },
    );
  },

  myTrades: (opts: { limit?: number; offset?: number } = {}) => {
    const params = new URLSearchParams();
    if (opts.limit != null) params.set('limit', String(opts.limit));
    if (opts.offset != null) params.set('offset', String(opts.offset));
    const qs = params.toString();
    return request<{ trades: Trade[]; limit: number; offset: number }>(
      `/me/trades${qs ? `?${qs}` : ''}`,
      { auth: true },
    );
  },

  // ─── Markets (public) ───────────────────────────────────────────────────
  listMarkets: (opts: { sport?: SportId | SportId[]; type?: string } = {}) => {
    const params = new URLSearchParams();
    if (opts.sport) {
      const v = Array.isArray(opts.sport) ? opts.sport.join(',') : opts.sport;
      params.set('sport', v);
    }
    if (opts.type) params.set('type', opts.type);
    const qs = params.toString();
    return request<MarketListItem[]>(`/markets${qs ? `?${qs}` : ''}`);
  },

  market: (id: string) => request<MarketDetail>(`/markets/${id}`),

  marketBook: (id: string) => request<OrderBookSnapshot>(`/markets/${id}/book`),

  marketTrades: (id: string, opts: { limit?: number } = {}) => {
    const params = new URLSearchParams();
    if (opts.limit != null) params.set('limit', String(opts.limit));
    const qs = params.toString();
    return request<{ trades: Trade[]; limit: number; offset: number }>(
      `/markets/${id}/trades${qs ? `?${qs}` : ''}`,
    );
  },

  marketCandles: (id: string, opts: { bucket?: number; hours?: number } = {}) => {
    const params = new URLSearchParams();
    if (opts.bucket != null) params.set('bucket', String(opts.bucket));
    if (opts.hours != null) params.set('hours', String(opts.hours));
    const qs = params.toString();
    return request<CandleSeries>(`/markets/${id}/candles${qs ? `?${qs}` : ''}`);
  },

  // ─── Comments ───────────────────────────────────────────────────────────
  marketComments: (id: string) => request<Comment[]>(`/markets/${id}/comments`),

  postComment: (marketId: string, body: string) =>
    request<Comment>(`/markets/${marketId}/comments`, {
      method: 'POST',
      json: { body },
      auth: true,
    }),

  voteComment: (commentId: string, value: 1 | -1) =>
    request<{ score: number }>(`/comments/${commentId}/vote`, {
      method: 'POST',
      json: { value },
      auth: true,
    }),

  // ─── Leaderboard ────────────────────────────────────────────────────────
  leaderboard: () => request<LeaderboardResponse>('/leaderboard'),

  // ─── Bot stats ──────────────────────────────────────────────────────────
  botStats: () => request<BotsStatsResponse>('/bots/stats'),

  botDailyAccuracy: (days = 30) =>
    request<DailyAccuracyResponse>(`/bots/daily-accuracy?days=${days}`),

  // ─── Orders ─────────────────────────────────────────────────────────────
  placeOrder: (body: PlaceOrderRequest) =>
    request<PlaceOrderResponse>('/orders', {
      method: 'POST',
      json: body,
      auth: true,
    }),

  cancelOrder: (orderId: string) =>
    request<{ order: Order }>(`/orders/${orderId}`, {
      method: 'DELETE',
      auth: true,
    }),

  // ─── Sports ─────────────────────────────────────────────────────────────
  sports: () => request<Array<{ id: SportId; name: string }>>('/sports'),

  // ─── Admin (requires isAdmin) ───────────────────────────────────────────
  adminStats: () =>
    request<{
      marketsByStatus: Record<string, number>;
      userCount: number;
      volume24h: number;
    }>('/admin/stats', { auth: true }),

  adminMarkets: (opts: { status?: string; sport?: string; limit?: number; offset?: number } = {}) => {
    const params = new URLSearchParams();
    if (opts.status) params.set('status', opts.status);
    if (opts.sport) params.set('sport', opts.sport);
    if (opts.limit != null) params.set('limit', String(opts.limit));
    if (opts.offset != null) params.set('offset', String(opts.offset));
    const qs = params.toString();
    return request<AdminMarket[]>(`/admin/markets${qs ? `?${qs}` : ''}`, { auth: true });
  },

  adminCreateMarket: (body: {
    eventId: string;
    type: 'MONEYLINE' | 'TOTAL' | 'SPREAD';
    line?: number;
    question?: string;
    yesLabel?: string;
    noLabel?: string;
  }) =>
    request<{ market: AdminMarketBrief }>('/admin/markets', {
      method: 'POST',
      json: body,
      auth: true,
    }),

  adminCloseMarket: (id: string) =>
    request<{ market: AdminMarketBrief; canceledOrderIds: string[] }>(
      `/admin/markets/${id}/close`,
      { method: 'POST', auth: true },
    ),

  adminResolveMarket: (id: string, outcome: 'YES' | 'NO' | 'INVALID') =>
    request<{ market: AdminMarketBrief; payouts: Array<{ userId: string; payout: number }> }>(
      `/admin/markets/${id}/resolve`,
      { method: 'POST', json: { outcome }, auth: true },
    ),

  adminVoidMarket: (id: string, reason: string) =>
    request<{ market: AdminMarketBrief; refunds: Array<{ userId: string; payout: number }> }>(
      `/admin/markets/${id}/void`,
      { method: 'POST', json: { reason }, auth: true },
    ),

  adminEvents: (opts: { status?: string; sport?: string; limit?: number; offset?: number } = {}) => {
    const params = new URLSearchParams();
    if (opts.status) params.set('status', opts.status);
    if (opts.sport) params.set('sport', opts.sport);
    if (opts.limit != null) params.set('limit', String(opts.limit));
    if (opts.offset != null) params.set('offset', String(opts.offset));
    const qs = params.toString();
    return request<AdminEvent[]>(`/admin/events${qs ? `?${qs}` : ''}`, { auth: true });
  },

  adminFinalizeEvent: (id: string, body: { homeScore: number; awayScore: number }) =>
    request<{
      event: { id: string; homeScore: number; awayScore: number; status: string };
      resolved: Array<{ marketId: string; outcome: string }>;
    }>(`/admin/events/${id}/finalize`, { method: 'POST', json: body, auth: true }),

  adminUsers: (opts: { limit?: number; offset?: number } = {}) => {
    const params = new URLSearchParams();
    if (opts.limit != null) params.set('limit', String(opts.limit));
    if (opts.offset != null) params.set('offset', String(opts.offset));
    const qs = params.toString();
    return request<AdminUser[]>(`/admin/users${qs ? `?${qs}` : ''}`, { auth: true });
  },

  adminTopupUser: (id: string, amount: number) =>
    request<{ wallet: { userId: string; balance: number; reserved: number } }>(
      `/admin/users/${id}/topup`,
      { method: 'POST', json: { amount }, auth: true },
    ),

  adminCalibration: (days: number) =>
    request<CalibrationResponse>(`/admin/calibration?days=${days}`, { auth: true }),
};

export interface AdminMarketBrief {
  id: string;
  type: string;
  question: string;
  line: number | null;
  status: string;
  outcome: string | null;
  closedAt: string | null;
  resolvedAt: string | null;
  eventId: string;
}

export interface AdminMarket extends AdminMarketBrief {
  event: {
    id: string;
    sportId: string;
    homeTeam: string;
    awayTeam: string;
    startsAt: string;
    status: string;
    homeScore: number | null;
    awayScore: number | null;
  };
}

export interface AdminEvent {
  id: string;
  sportId: string;
  externalId: string;
  homeTeam: string;
  awayTeam: string;
  startsAt: string;
  status: string;
  homeScore: number | null;
  awayScore: number | null;
  marketCount: number;
}

export interface AdminUser {
  id: string;
  email: string;
  username: string;
  isAdmin: boolean;
  createdAt: string;
  wallet: { balance: number; reserved: number } | null;
}
