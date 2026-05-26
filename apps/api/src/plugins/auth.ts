import fp from 'fastify-plugin';
import fastifyJwt from '@fastify/jwt';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { HttpError } from '../lib/errors.js';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string; email: string; isAdmin?: boolean };
    user: { id: string; email: string; isAdmin: boolean };
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireAdmin: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

interface AuthPluginOptions {
  secret: string;
}

export default fp<AuthPluginOptions>(async (fastify, opts) => {
  await fastify.register(fastifyJwt, {
    secret: opts.secret,
    sign: { expiresIn: '24h' },
    formatUser: (payload) => ({
      id: payload.sub,
      email: payload.email,
      isAdmin: payload.isAdmin === true,
    }),
  });

  fastify.decorate('authenticate', async (req: FastifyRequest) => {
    try {
      await req.jwtVerify();
    } catch {
      throw new HttpError(401, 'UNAUTHORIZED', 'Missing or invalid bearer token');
    }
  });

  fastify.decorate('requireAdmin', async (req: FastifyRequest) => {
    try {
      await req.jwtVerify();
    } catch {
      throw new HttpError(401, 'UNAUTHORIZED', 'Missing or invalid bearer token');
    }
    if (!req.user.isAdmin) {
      throw new HttpError(403, 'FORBIDDEN', 'Admin privilege required');
    }
  });
});
