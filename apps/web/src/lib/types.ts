export type SportId = 'mlb' | 'nfl' | 'nba' | 'nhl';
export type MarketType = 'MONEYLINE' | 'TOTAL' | 'SPREAD';
export type MarketStatus = 'OPEN' | 'CLOSED' | 'RESOLVED' | 'VOIDED';
export type Outcome = 'YES' | 'NO';
export type OrderSide = 'BUY' | 'SELL';
export type OrderStatus = 'OPEN' | 'PARTIAL' | 'FILLED' | 'CANCELED';

export interface PublicUser {
  id: string;
  email: string;
  username: string;
  isAdmin: boolean;
  createdAt: string;
}

export interface EventBrief {
  id: string;
  sportId: SportId;
  homeTeam: string;
  awayTeam: string;
  startsAt: string;
  status: 'SCHEDULED' | 'LIVE' | 'FINAL' | 'POSTPONED' | 'CANCELED';
}

export interface MarketListItem {
  id: string;
  type: MarketType;
  question: string;
  yesLabel: string;
  noLabel: string;
  line: number | null;
  status: MarketStatus;
  event: EventBrief;
  topOfBook: {
    yesBid: number | null;
    yesAsk: number | null;
    noBid: number | null;
    noAsk: number | null;
  };
  depth?: {
    yesBidQty: number;
    yesAskQty: number;
    noBidQty: number;
    noAskQty: number;
  };
  lastTradePrice: number | null;
  volume24h?: number;
  traders?: number;
}

export interface MarketDetail extends Omit<MarketListItem, 'lastTradePrice'> {
  outcome: 'YES' | 'NO' | 'INVALID' | null;
  closedAt: string | null;
  resolvedAt: string | null;
  lastTrade: { price: number; at: string } | null;
}

export interface OrderBookLevel {
  price: number;
  quantity: number;
}

export interface OrderBookSnapshot {
  marketId: string;
  yesBids: OrderBookLevel[];
  yesAsks: OrderBookLevel[];
  noBids: OrderBookLevel[];
  noAsks: OrderBookLevel[];
  lastTradePrice?: number;
  lastTradeAt?: string;
}

export interface Trade {
  id: string;
  marketId: string;
  outcome: Outcome;
  price: number;
  quantity: number;
  buyerUserId: string;
  sellerUserId: string;
  createdAt: string;
}

export interface Order {
  id: string;
  marketId: string;
  userId: string;
  side: OrderSide;
  outcome: Outcome;
  price: number;
  quantity: number;
  filled: number;
  status: OrderStatus;
  createdAt: string;
  updatedAt: string;
}

export interface Wallet {
  balance: number;
  reserved: number;
  available: number;
}

export interface Position {
  marketId: string;
  yesShares: number;
  noShares: number;
  avgYesCost: number | null;
  avgNoCost: number | null;
  realizedPnl: number;
  lastTradePrice: number | null;
  market: {
    id: string;
    question: string;
    type: MarketType;
    status: MarketStatus;
  };
}

export interface PlaceOrderRequest {
  marketId: string;
  side: OrderSide;
  outcome: Outcome;
  price: number;
  quantity: number;
}

export interface PlaceOrderResponse {
  order: Order;
  fills: Trade[];
}

export interface Candle {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface CandleSeries {
  marketId: string;
  bucketMs: number;
  hours: number;
  candles: Candle[];
}

export interface Comment {
  id: string;
  body: string;
  createdAt: string;
  user: { id: string; username: string };
  score: number;
  skin: { side: 'YES' | 'NO'; shares: number } | null;
}

export interface LeaderboardEntry {
  userId: string;
  username: string;
}

export interface PnlLeaderEntry extends LeaderboardEntry {
  realizedPnl: number;
}

export interface VolumeLeaderEntry extends LeaderboardEntry {
  volume24h: number;
}

export interface LeaderboardResponse {
  byPnl: PnlLeaderEntry[];
  byVolume: VolumeLeaderEntry[];
}

export interface BotCalibrationBin {
  bin: number;
  predicted: number;
  actual: number;
  count: number;
  wins: number;
}

export interface BotSimulatedStat {
  predictions: number;
  accuracy: number;
  brierScore: number;
  pnlCents: number;
  calibration: BotCalibrationBin[];
}

export interface BotStat {
  username: string;
  userId: string;
  balance: number;
  reserved: number;
  marketsTraded: number;
  marketsResolved: number;
  correctCalls: number;
  accuracy: number | null;
  brierScore: number | null;
  realizedPnl: number;
  calibration: BotCalibrationBin[];
  simulated: BotSimulatedStat | null;
}

export interface BotsStatsResponse {
  bots: BotStat[];
  backtest: { events: number; generatedAt: string };
}

export interface CalibrationBucket {
  bin: string;
  midpoint: number;
  sampleSize: number;
  expectedYesProb: number;
  actualYesProb: number;
  brierContrib: number;
}

export interface CalibrationResponse {
  windowDays: number;
  totalMarkets: number;
  brierScore: number | null;
  calibrationError: number | null;
  buckets: CalibrationBucket[];
}

export interface DailyAccuracyRow {
  date: string;
  platformAccuracy: number | null;
  platformResolved: number;
  bots: Record<string, { accuracy: number | null; resolved: number }>;
}

export interface DailyAccuracyResponse {
  windowDays: number;
  bots: string[];
  days: DailyAccuracyRow[];
}
