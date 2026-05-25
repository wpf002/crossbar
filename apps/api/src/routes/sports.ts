import type { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';

export default async function sportsRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/sports', async () => {
    const sports = await prisma.sport.findMany({
      select: { id: true, name: true },
      orderBy: { id: 'asc' },
    });
    return sports;
  });
}
