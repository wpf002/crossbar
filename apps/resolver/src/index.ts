// Resolver: polls ESPN for game results, closes & resolves markets.
// Implementation in next iteration.
import pino from 'pino';

const log = pino({
  transport:
    process.env.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined,
});

log.info('crossbar resolver starting (stub) — polling logic to be implemented');

setInterval(() => {}, 1 << 30);
