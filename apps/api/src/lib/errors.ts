import type { FastifyReply } from 'fastify';
import { ZodError } from 'zod';
import {
  EngineError,
  InsufficientFundsError,
  InsufficientPositionError,
  InvalidOrderError,
  InvalidPriceError,
  MarketNotOpenError,
  OrderNotFoundError,
  SelfTradeError,
} from '@crossbar/engine';

interface ErrorBody {
  error: string;
  message: string;
  issues?: Array<{ path: string; message: string }>;
}

interface MappedError {
  status: number;
  body: ErrorBody;
}

/** Translate any thrown error into an HTTP status + JSON body. */
export function mapError(err: unknown): MappedError {
  if (err instanceof ZodError) {
    return {
      status: 422,
      body: {
        error: 'VALIDATION_ERROR',
        message: 'Request failed validation',
        issues: err.issues.map((i) => ({
          path: i.path.map(String).join('.'),
          message: i.message,
        })),
      },
    };
  }

  if (err instanceof InvalidPriceError) {
    return { status: 400, body: { error: 'INVALID_PRICE', message: err.message } };
  }
  if (err instanceof InvalidOrderError) {
    return { status: 422, body: { error: 'VALIDATION_ERROR', message: err.message } };
  }
  if (err instanceof InsufficientFundsError) {
    return { status: 402, body: { error: 'INSUFFICIENT_FUNDS', message: err.message } };
  }
  if (err instanceof InsufficientPositionError) {
    return { status: 402, body: { error: 'INSUFFICIENT_POSITION', message: err.message } };
  }
  if (err instanceof MarketNotOpenError) {
    return { status: 409, body: { error: 'MARKET_NOT_OPEN', message: err.message } };
  }
  if (err instanceof OrderNotFoundError) {
    return { status: 404, body: { error: 'ORDER_NOT_FOUND', message: err.message } };
  }
  if (err instanceof SelfTradeError) {
    return { status: 409, body: { error: 'SELF_TRADE', message: err.message } };
  }
  if (err instanceof EngineError) {
    return { status: 400, body: { error: err.code, message: err.message } };
  }

  if (isHttpishError(err)) {
    return {
      status: err.statusCode,
      body: { error: err.code ?? mapStatusToCode(err.statusCode), message: err.message },
    };
  }

  return {
    status: 500,
    body: { error: 'INTERNAL_ERROR', message: 'Internal Server Error' },
  };
}

/** Errors thrown by us (or fastify-sensible) that carry a statusCode. */
interface HttpishError {
  statusCode: number;
  message: string;
  code?: string;
}

function isHttpishError(err: unknown): err is HttpishError {
  return (
    typeof err === 'object' &&
    err !== null &&
    typeof (err as { statusCode?: unknown }).statusCode === 'number' &&
    typeof (err as { message?: unknown }).message === 'string'
  );
}

function mapStatusToCode(status: number): string {
  switch (status) {
    case 400:
      return 'BAD_REQUEST';
    case 401:
      return 'UNAUTHORIZED';
    case 403:
      return 'FORBIDDEN';
    case 404:
      return 'NOT_FOUND';
    case 409:
      return 'CONFLICT';
    case 422:
      return 'VALIDATION_ERROR';
    case 429:
      return 'RATE_LIMITED';
    default:
      return 'ERROR';
  }
}

/** Convenience for routes to throw a typed HTTP error. */
export class HttpError extends Error {
  readonly statusCode: number;
  readonly code: string;
  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

export function sendError(reply: FastifyReply, err: unknown): FastifyReply {
  const { status, body } = mapError(err);
  return reply.code(status).send(body);
}
