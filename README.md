# Crossbar

A peer-to-peer prediction market for major US sports — MLB, NFL, NBA, NHL.

Users buy and sell shares in **YES** / **NO** outcomes via a continuous limit order book. Each share pays $1.00 if its outcome wins, $0.00 if it loses. Prices range from 1¢ to 99¢ and represent the implied probability of an outcome.

**v1 uses play money.** Every new user starts with $1,000 of fake currency. This eliminates regulatory, banking, and KYC complexity while validating the core mechanics: the matching engine, market design, liquidity dynamics, and resolution. Real-money support is a swap of the `Wallet` model when (if) it's warranted.

---

## Architecture

```
┌─────────────┐        ┌─────────────┐        ┌──────────────┐
│   web       │───────▶│    api      │───────▶│  matcher     │
│  (Next.js)  │  HTTP  │  (Fastify)  │  Redis │ (in-memory   │
│             │        │             │ Stream │  order book) │
└─────────────┘        └──────┬──────┘        └──────┬───────┘
                              │                      │
                              ▼                      ▼
                       ┌─────────────────────────────────┐
                       │   PostgreSQL (Prisma)           │
                       └─────────────────────────────────┘
                                      ▲
                                      │
                              ┌───────┴────────┐
                              │   resolver     │
                              │  (cron + ESPN) │
                              └────────────────┘
```

- **`apps/web`** — Next.js 14 frontend (App Router)
- **`apps/api`** — Fastify HTTP API (auth, orders, markets, positions)
- **`apps/matcher`** — Long-running order matching engine, Redis-backed
- **`apps/resolver`** — Cron job that polls ESPN and resolves markets
- **`packages/db`** — Prisma schema + client
- **`packages/shared`** — Shared types, Zod schemas, constants
- **`packages/sports`** — ESPN API client + per-sport adapters

---

## Tech Stack

- TypeScript everywhere, pnpm workspaces
- Next.js 14 (web), Fastify 4 (api)
- PostgreSQL 16 + Prisma
- Redis 7 (live order book state, pub/sub)
- Docker Compose for local infra
- Node 20+

---

## Quick Start

```bash
# Prereqs: Node 20+, Docker, pnpm 9
corepack enable
corepack prepare pnpm@9.7.0 --activate

# Install
pnpm install

# Start postgres + redis
pnpm infra:up

# Database
pnpm db:generate
pnpm db:migrate --name init
pnpm db:seed

# Dev (run each in its own terminal)
pnpm dev:api        # http://localhost:4000
pnpm dev:web        # http://localhost:3000
pnpm dev:matcher
pnpm dev:resolver
```

---

## Domain Model

### Markets

Every game generates up to three markets:

| Type        | Question                                      | Resolves YES when                           |
|-------------|-----------------------------------------------|----------------------------------------------|
| `MONEYLINE` | Will the home team win?                       | Home final score > away final score          |
| `TOTAL`     | Will combined score go OVER `line`?           | Combined score > line                        |
| `SPREAD`    | Will home team cover the spread (`line`)?     | (Home - Away) > line                         |

### Orders

Limit orders only (no market orders in v1). Each order specifies:
- **side** — `BUY` or `SELL`
- **outcome** — `YES` or `NO`
- **price** — integer 1-99 (cents per share)
- **quantity** — integer number of shares

A `BUY YES @ 60¢` matches against either `SELL YES @ 60¢` or `BUY NO @ 40¢` (since `YES + NO = 100¢` for a fully-funded contract pair).

### Resolution

The `resolver` polls ESPN's public scoreboard endpoints every 60s. When an event hits `STATUS_FINAL`, all markets on that event are scored, winning shares pay out at $1.00, and balances are credited.

---

## Project Layout

```
crossbar/
├── apps/
│   ├── web/          # Next.js frontend
│   ├── api/          # Fastify HTTP API
│   ├── matcher/      # Order matching engine (long-running)
│   └── resolver/     # ESPN poller + market resolution
├── packages/
│   ├── db/           # Prisma schema, client
│   ├── shared/       # Types, validators, constants
│   └── sports/       # ESPN client, sport adapters
├── docker-compose.yml
├── pnpm-workspace.yaml
└── package.json
```

---

## Roadmap

**Phase 1 — Core engine** *(in progress)*
- [x] Monorepo scaffold
- [x] Prisma schema (users, wallets, markets, orders, trades, positions)
- [ ] Matching engine (in-memory order book, Redis persistence)
- [ ] HTTP API (auth, place/cancel orders, market list, positions)
- [ ] Resolver (ESPN polling, auto-resolution)
- [ ] Minimal web UI (market list, order entry, portfolio)

**Phase 2 — Real users**
- [ ] Email/password auth
- [ ] Live order book updates (SSE)
- [ ] Trade history, P&L charts
- [ ] Admin dashboard (manual market creation, dispute resolution)

**Phase 3 — Scale**
- [ ] Move matching engine to Rust or in-memory Node service with WAL
- [ ] Player props markets
- [ ] In-game live markets
- [ ] Calibration dashboard (Brier scores vs Pinnacle close)

**Phase 4 — Real money** *(only if warranted)*
- [ ] USDC integration via Privy
- [ ] KYC via Persona/Stripe
- [ ] Geo-blocking
- [ ] Smart contract layer for settlement

---

## License

MIT
