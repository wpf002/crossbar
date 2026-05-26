import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { hashPassword, verifyPassword } from '../lib/auth.js';
import { HttpError } from '../lib/errors.js';

const SignupSchema = z.object({
  email: z.string().email(),
  username: z
    .string()
    .min(3)
    .max(32)
    .regex(/^[a-zA-Z0-9_-]+$/, 'Username may only contain letters, numbers, _ and -'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

function publicUser(u: {
  id: string;
  email: string;
  username: string;
  isAdmin: boolean;
  createdAt: Date;
}) {
  return {
    id: u.id,
    email: u.email,
    username: u.username,
    isAdmin: u.isAdmin,
    createdAt: u.createdAt.toISOString(),
  };
}

export default async function authRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post('/signup', async (req) => {
    const body = SignupSchema.parse(req.body);

    const existing = await prisma.user.findFirst({
      where: { OR: [{ email: body.email }, { username: body.username }] },
      select: { email: true, username: true },
    });
    if (existing) {
      const field = existing.email === body.email ? 'email' : 'username';
      throw new HttpError(409, 'CONFLICT', `An account with that ${field} already exists`);
    }

    const passwordHash = await hashPassword(body.password);

    const user = await prisma.user.create({
      data: {
        email: body.email,
        username: body.username,
        passwordHash,
        wallet: { create: {} }, // defaults: balance=100_000, reserved=0
      },
    });

    const token = fastify.jwt.sign({
      sub: user.id,
      email: user.email,
      isAdmin: user.isAdmin,
    });
    return { user: publicUser(user), token };
  });

  fastify.post('/login', async (req) => {
    const body = LoginSchema.parse(req.body);

    const user = await prisma.user.findUnique({
      where: { email: body.email },
    });
    if (!user) {
      throw new HttpError(401, 'UNAUTHORIZED', 'Invalid email or password');
    }
    const ok = await verifyPassword(body.password, user.passwordHash);
    if (!ok) {
      throw new HttpError(401, 'UNAUTHORIZED', 'Invalid email or password');
    }

    const token = fastify.jwt.sign({
      sub: user.id,
      email: user.email,
      isAdmin: user.isAdmin,
    });
    return { user: publicUser(user), token };
  });
}
