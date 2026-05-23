// Matching engine entry point — implementation in next iteration.
import pino from 'pino';

const log = pino({
  transport:
    process.env.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined,
});

log.info('crossbar matcher starting (stub) — engine to be implemented');

// Keep process alive so docker/dev keeps it up
setInterval(() => {}, 1 << 30);
