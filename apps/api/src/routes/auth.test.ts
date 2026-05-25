import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { prisma } from '@crossbar/db';
import { bearer, makeApp } from '../test-helpers.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await makeApp();
});

afterAll(async () => {
  await app.close();
});

describe('POST /auth/signup', () => {
  it('creates user + wallet with $1,000 balance and returns a token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: { email: 'alice@test.local', username: 'alice', password: 'hunter2hunter2' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { user: { id: string; email: string; username: string }; token: string };
    expect(body.user.email).toBe('alice@test.local');
    expect(body.user.username).toBe('alice');
    expect(body.token).toBeTypeOf('string');

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: body.user.id } });
    expect(wallet.balance).toBe(100_000);
    expect(wallet.reserved).toBe(0);
  });

  it('rejects duplicate email', async () => {
    await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: { email: 'dup@test.local', username: 'dup1', password: 'hunter2hunter2' },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: { email: 'dup@test.local', username: 'dup2', password: 'hunter2hunter2' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'CONFLICT' });
  });

  it('rejects weak password (<8 chars)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: { email: 'weak@test.local', username: 'weakling', password: 'short' },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ error: 'VALIDATION_ERROR' });
  });
});

describe('POST /auth/login', () => {
  it('returns a token with valid credentials', async () => {
    await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: { email: 'bob@test.local', username: 'bob', password: 'hunter2hunter2' },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'bob@test.local', password: 'hunter2hunter2' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { token: string };
    expect(body.token).toBeTypeOf('string');
  });

  it('returns 401 with wrong password', async () => {
    await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: { email: 'carol@test.local', username: 'carol', password: 'hunter2hunter2' },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'carol@test.local', password: 'wrongpass' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: 'UNAUTHORIZED' });
  });
});

describe('Bearer token auth', () => {
  it('authorizes requests with a valid token', async () => {
    const signup = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: { email: 'dave@test.local', username: 'dave', password: 'hunter2hunter2' },
    });
    const { token } = signup.json() as { token: string };

    const res = await app.inject({ method: 'GET', url: '/me', headers: bearer(token) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ email: 'dave@test.local', username: 'dave' });
  });

  it('rejects requests without a token', async () => {
    const res = await app.inject({ method: 'GET', url: '/me' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: 'UNAUTHORIZED' });
  });
});
