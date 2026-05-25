import type { FastifyInstance } from 'fastify';
import { prisma } from '@crossbar/db';
import { buildApp } from './app.js';

export async function makeApp(): Promise<FastifyInstance> {
  return buildApp({
    env: {
      NODE_ENV: 'test',
      API_PORT: 4000,
      JWT_SECRET: 'test-jwt-secret-1234567890',
    },
  });
}

export interface SignedUpUser {
  id: string;
  email: string;
  username: string;
  token: string;
}

export async function signupUser(
  app: FastifyInstance,
  overrides: Partial<{ email: string; username: string; password: string }> = {},
): Promise<SignedUpUser> {
  const suffix = Math.random().toString(36).slice(2, 10);
  const body = {
    email: overrides.email ?? `user-${suffix}@test.local`,
    username: overrides.username ?? `user_${suffix}`,
    password: overrides.password ?? 'correct-horse-battery',
  };
  const res = await app.inject({ method: 'POST', url: '/auth/signup', payload: body });
  if (res.statusCode !== 200) {
    throw new Error(`signup failed: ${res.statusCode} ${res.payload}`);
  }
  const parsed = res.json() as { user: { id: string; email: string; username: string }; token: string };
  return {
    id: parsed.user.id,
    email: parsed.user.email,
    username: parsed.user.username,
    token: parsed.token,
  };
}

export function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

export async function makeOpenMarket(): Promise<string> {
  await prisma.sport.upsert({
    where: { id: 'mlb' },
    update: {},
    create: { id: 'mlb', name: 'MLB' },
  });

  const event = await prisma.event.create({
    data: {
      sportId: 'mlb',
      externalId: `evt-${Date.now()}-${Math.random()}`,
      homeTeam: 'HOME',
      awayTeam: 'AWAY',
      startsAt: new Date(Date.now() + 3600_000),
    },
  });

  const market = await prisma.market.create({
    data: {
      eventId: event.id,
      type: 'MONEYLINE',
      question: 'Will HOME beat AWAY?',
      yesLabel: 'HOME wins',
      noLabel: 'AWAY wins',
    },
  });
  return market.id;
}

export async function makeClosedMarket(): Promise<string> {
  await prisma.sport.upsert({
    where: { id: 'nba' },
    update: {},
    create: { id: 'nba', name: 'NBA' },
  });
  const event = await prisma.event.create({
    data: {
      sportId: 'nba',
      externalId: `evt-closed-${Date.now()}-${Math.random()}`,
      homeTeam: 'X',
      awayTeam: 'Y',
      startsAt: new Date(Date.now() + 3600_000),
    },
  });
  const market = await prisma.market.create({
    data: {
      eventId: event.id,
      type: 'MONEYLINE',
      question: 'Will X beat Y?',
      yesLabel: 'X wins',
      noLabel: 'Y wins',
      status: 'CLOSED',
    },
  });
  return market.id;
}
