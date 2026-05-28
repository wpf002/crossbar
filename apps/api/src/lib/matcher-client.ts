import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import { HttpError } from './errors.js';

/**
 * Synchronous RPC over Redis Streams. The API XADDs an order request onto
 * `orders:incoming` and BLPOPs the matcher's reply off a per-request queue.
 * The matcher (apps/matcher) is the sole owner of in-memory books; this keeps
 * the HTTP contract synchronous while moving matching out of the API process.
 */

const DEFAULT_STREAM = 'orders:incoming';

export type MatcherAction =
  | 'place_order'
  | 'cancel_order'
  | 'close_market'
  | 'resolve_market'
  | 'void_market'
  | 'create_market';

interface ReplyError {
  code: string;
  message: string;
  status?: number;
}

export interface MatcherClient {
  request<T = unknown>(
    action: MatcherAction,
    userId: string,
    payload: unknown,
    timeoutMs?: number,
  ): Promise<T>;
  close(): Promise<void>;
}

export function createMatcherClient(redisUrl: string, stream: string = DEFAULT_STREAM): MatcherClient {
  // One persistent connection for XADD. BLPOP needs its own (blocking)
  // connection per in-flight request so concurrent requests don't queue behind
  // each other — we duplicate the base client and tear it down after each call.
  const base = new Redis(redisUrl, { maxRetriesPerRequest: null });

  return {
    async request<T>(
      action: MatcherAction,
      userId: string,
      payload: unknown,
      timeoutMs = 5000,
    ): Promise<T> {
      const requestId = randomUUID();
      const replyKey = `orders:result:${requestId}`;

      await base.xadd(
        stream,
        '*',
        'requestId',
        requestId,
        'action',
        action,
        'userId',
        userId,
        'payload',
        JSON.stringify(payload),
      );

      const blocking = base.duplicate();
      try {
        const res = await blocking.blpop(replyKey, timeoutMs / 1000);
        if (!res) {
          throw new HttpError(504, 'GATEWAY_TIMEOUT', 'Matcher did not respond');
        }
        const reply = JSON.parse(res[1]) as
          | { status: 'ok'; data: T }
          | { status: 'error'; error: ReplyError };
        if (reply.status === 'error') {
          throw mapErrorFromReply(reply.error);
        }
        return reply.data;
      } finally {
        blocking.disconnect();
      }
    },

    async close() {
      base.disconnect();
    },
  };
}

/** A matcher client used when Redis isn't configured — every call 503s. */
export function nullMatcherClient(): MatcherClient {
  return {
    async request<T>(): Promise<T> {
      throw new HttpError(503, 'SERVICE_UNAVAILABLE', 'Matcher transport is not configured');
    },
    async close() {
      /* no-op */
    },
  };
}

function mapErrorFromReply(err: ReplyError): HttpError {
  return new HttpError(err.status ?? 400, err.code, err.message);
}
