import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(4000),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  REDIS_URL: z.string().url().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(): Env {
  const parsed = EnvSchema.safeParse({
    NODE_ENV: process.env.NODE_ENV,
    API_PORT: process.env.API_PORT,
    JWT_SECRET: process.env.JWT_SECRET ?? (process.env.NODE_ENV === 'test' ? 'test-jwt-secret-1234567890' : undefined),
    REDIS_URL: process.env.REDIS_URL,
  });
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment: ${issues}`);
  }
  return parsed.data;
}
