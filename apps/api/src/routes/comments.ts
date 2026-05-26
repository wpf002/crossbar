import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { HttpError } from '../lib/errors.js';

const CreateCommentSchema = z.object({
  body: z.string().min(1).max(2000),
});

const VoteSchema = z.object({
  value: z.number().int().refine((v) => v === 1 || v === -1, 'value must be +1 or -1'),
});

export default async function commentsRoutes(fastify: FastifyInstance): Promise<void> {
  // Public: list comments on a market with their score and the user's own position-size.
  fastify.get<{ Params: { marketId: string } }>(
    '/markets/:marketId/comments',
    async (req) => {
      const exists = await prisma.market.findUnique({
        where: { id: req.params.marketId },
        select: { id: true },
      });
      if (!exists) throw new HttpError(404, 'NOT_FOUND', 'Market not found');

      const rows = await prisma.comment.findMany({
        where: { marketId: req.params.marketId },
        orderBy: { createdAt: 'desc' },
        take: 100,
        include: {
          user: { select: { id: true, username: true } },
          votes: { select: { value: true, userId: true } },
        },
      });

      const userIds = rows.map((c) => c.userId);
      const positions = await prisma.position.findMany({
        where: { marketId: req.params.marketId, userId: { in: userIds } },
        select: { userId: true, yesShares: true, noShares: true },
      });
      const posMap = new Map(positions.map((p) => [p.userId, p]));

      return rows.map((c) => {
        const pos = posMap.get(c.userId);
        const skin =
          (pos?.yesShares ?? 0) > (pos?.noShares ?? 0)
            ? { side: 'YES' as const, shares: pos!.yesShares }
            : (pos?.noShares ?? 0) > 0
              ? { side: 'NO' as const, shares: pos!.noShares }
              : null;
        return {
          id: c.id,
          body: c.body,
          createdAt: c.createdAt.toISOString(),
          user: c.user,
          score: c.votes.reduce((a, v) => a + v.value, 0),
          skin,
        };
      });
    },
  );

  // Authed: post a comment
  fastify.post<{ Params: { marketId: string } }>(
    '/markets/:marketId/comments',
    { preHandler: fastify.authenticate },
    async (req) => {
      const { body } = CreateCommentSchema.parse(req.body);
      const exists = await prisma.market.findUnique({
        where: { id: req.params.marketId },
        select: { id: true },
      });
      if (!exists) throw new HttpError(404, 'NOT_FOUND', 'Market not found');

      const c = await prisma.comment.create({
        data: { marketId: req.params.marketId, userId: req.user.id, body },
        include: { user: { select: { id: true, username: true } } },
      });
      return {
        id: c.id,
        body: c.body,
        createdAt: c.createdAt.toISOString(),
        user: c.user,
        score: 0,
        skin: null,
      };
    },
  );

  // Authed: vote on a comment
  fastify.post<{ Params: { id: string } }>(
    '/comments/:id/vote',
    { preHandler: fastify.authenticate },
    async (req) => {
      const { value } = VoteSchema.parse(req.body);
      const exists = await prisma.comment.findUnique({
        where: { id: req.params.id },
        select: { id: true },
      });
      if (!exists) throw new HttpError(404, 'NOT_FOUND', 'Comment not found');

      await prisma.commentVote.upsert({
        where: { commentId_userId: { commentId: req.params.id, userId: req.user.id } },
        create: { commentId: req.params.id, userId: req.user.id, value },
        update: { value },
      });
      const all = await prisma.commentVote.findMany({
        where: { commentId: req.params.id },
        select: { value: true },
      });
      return { score: all.reduce((a, v) => a + v.value, 0) };
    },
  );
}
