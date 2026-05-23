import { z } from 'zod';
import { MIN_PRICE, MAX_PRICE } from './constants.js';

export const PlaceOrderSchema = z.object({
  marketId: z.string().min(1),
  side: z.enum(['BUY', 'SELL']),
  outcome: z.enum(['YES', 'NO']),
  price: z.number().int().min(MIN_PRICE).max(MAX_PRICE),
  quantity: z.number().int().positive().max(1_000_000),
});

export type PlaceOrderInput = z.infer<typeof PlaceOrderSchema>;
