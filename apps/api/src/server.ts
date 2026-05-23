import Fastify from 'fastify';
import cors from '@fastify/cors';

const app = Fastify({
  logger: {
    transport:
      process.env.NODE_ENV === 'development'
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
  },
});

await app.register(cors, { origin: true });

app.get('/health', async () => ({ ok: true, ts: Date.now() }));

const port = Number(process.env.API_PORT ?? 4000);
app.listen({ port, host: '0.0.0.0' }).then(() => {
  app.log.info(`crossbar api listening on :${port}`);
});
