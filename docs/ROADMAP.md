# Crossbar — Full Roadmap

> Status legend: ✓ shipped · partial · planned. Phases are sequenced for the
> "real product" path (the most demanding ordering); everything else is a subset.

## Shipped (Phases 1–3, partial)

### Phase 1 — Core engine ✓
- Monorepo scaffold, Prisma schema, Docker infra
- Order book, matching engine, atomic settlement
- HTTP API (auth, orders, markets, positions)
- Resolver (ESPN polling, auto-resolution)
- Web UI (markets, market detail, portfolio, wallet, leaderboard, bots)

### Phase 2 — Real-time + admin + P&L ✓
- Redis pub/sub event bus + SSE endpoints
- Web SSE hooks (TanStack cache integration)
- `User.isAdmin` + admin dashboard
- `/me/equity` endpoint + portfolio P&L chart

### Phase 2.5 — Bot calibration loop ✓
- `CalibrationLearner` (bucketed EWMA on residuals)
- `bot_adaptive` (wraps pinnacle through learner)
- `GET /bots/learner`

### Phase 3 (partial) — Matcher cutover + platform calibration ✓
- API publishes to Redis stream, matcher is sole book owner
- Per-request idempotency via `SET NX`
- `/admin/calibration` (platform reliability scatter + Brier)
- Public daily accuracy chart (platform vs bots, 7/30/90d)

---

## Phase 3 (remainder) — Finish what's scoped

### Player props markets ✓
- ✓ `Player` + `PlayerStat` models; ESPN summary (box-score) endpoint
- ✓ Per-sport prop catalogs (rushing yds, pts, hits, goals, etc.)
- ✓ Market type `PLAYER_TOTAL` (over/under on a player stat — consolidated the
  two roadmap names since they resolve identically)
- ✓ Resolution from per-player stat lines, not game outcomes
- ✓ Auto-generation from live box scores (opt-in `PLAYER_PROPS_AUTOGEN`) +
  admin manual creation; web admin form + sibling-market browsing

### Live in-game markets
- Resolver polls every 5–10s during LIVE games (vs 60s scheduled)
- Game-state tracker: period/clock/score captured each poll
- Markets that open mid-game (live moneyline updated for current score)
- Per-quarter / per-inning resolution windows
- The architecture handles this; the data pipeline is the work

---

## Phase 4 — Operational hardening (the unsexy phase that matters)

The architecture is production-shaped but the operations aren't.
Solo-dev-on-localhost has skipped the boring stuff. Before anyone else uses
this, do this phase.

### Observability
- Metrics: order placement latency p50/p95/p99, matcher consumer lag,
  settlement transaction time, SSE connection count, dedup hit rate
- Stack: pino → Loki, Prometheus, Grafana (or Datadog if paying)
- Distributed tracing: `requestId` already flows API→matcher; add OTEL spans
- Error tracking: Sentry (or self-hosted GlitchTip) on web + api + matcher

### Backups + disaster recovery
- Automated nightly PG dumps to S3 (or equivalent)
- Tested restore — do it once in anger before you need it
- Retention: daily/7d, weekly/4w, monthly/12m
- Redis: ephemeral by design, but document recovery (rehydrate matcher
  from PG, rebuild book snapshots)

### Rate limiting + abuse
- Tune `@fastify/rate-limit` per endpoint (signup tighter than `/markets`)
- Account creation: hCaptcha or Cloudflare Turnstile
- SSE connection limits per IP / per user
- Detect bot-like trading patterns even on play money (lays groundwork)

### Load testing
- k6 or artillery against API + matcher
- Targets: 100 orders/sec sustained, p95 latency < 500ms
- Find the matcher's single-process ceiling (likely <1000/s without Rust)
- Document the breaking point

### CI/CD
- GitHub Actions: typecheck, lint, test on every PR
- Block merge on red
- Deploy preview environments per PR (Vercel for web, fly.io for api)
- Automated deploy on merge to main

### Real deployment
- Pick a host: Railway, Fly.io, Render (Vercel for web only)
- Managed Postgres (Neon, Supabase, RDS)
- Managed Redis (Upstash, ElastiCache)
- Domain + DNS + HTTPS (Cloudflare)
- Staging environment that mirrors prod

### Security review
- JWT secret rotation policy
- CORS audit (specifically allow only your web origin)
- XSS audit on React components (Comments are user input)
- HTTPS everywhere, HSTS headers
- Cookie flags: secure, httpOnly, sameSite=lax
- Prisma protects from SQL injection; verify no raw queries

---

## Phase 5 — Product polish (make it feel finished)

### Onboarding
- Interactive walkthrough on first signup
- Explain YES/NO shares, prices = probability, limit orders
- First-trade tutorial market with guidance
- "What's a prediction market" `/how-it-works` page

### Account fundamentals
- Email verification (needs email provider — Resend or Postmark)
- Password reset flow
- 2FA via TOTP (also a Phase 7 pre-req)
- Change email, change password
- Delete account (with grace period for open positions)

### Mobile
- Responsive QA pass — Tailwind buys most of it; audit iPhone SE,
  mid-Android, iPad
- Bet slip drawer behavior on mobile (already partial)
- Touch targets, font sizes, scroll behavior
- PWA manifest for "add to home screen"

### Notifications
- In-app toast on order fill / market resolve / payout
- Web push (browser-level)
- Email digests: daily P&L, market resolutions, comment replies
- Per-channel preferences in account settings

### Content + help
- FAQ / glossary (implied probability, cross-match, depth, etc.)
- Educational content: "How to read an order book"
- Embedded help tooltips on technical UI elements
- Empty states: what does `/portfolio` look like for a new user?
- Loading states everywhere (skeleton screens)

---

## Phase 6 — Growth (only if you want users)

### More sports
- Soccer (huge international demand)
- Tennis (clean discrete outcomes per match)
- Golf (tournament winners as futures)
- MMA / boxing (per-fight + per-round markets)
- F1 (race winners, podium combinations)
- College football + basketball (high US engagement)
- Most are ESPN adapter ports — modest engineering

### Futures + long-dated markets
- Championship winners (Super Bowl, World Series, NBA Finals)
- Award markets (MVP, ROY, Cy Young)
- Win-totals (over/under team wins for the season)
- Long-dated markets are sticky — users return for them

### Social + community
- Public user profiles (positions, P&L history, badges)
- Follow other traders
- Activity feed
- Trade sharing (screenshot generator for X / Discord)
- Referral codes (extra play money for invites)

### Developer / power users
- Programmatic API + API keys
- REST docs (OpenAPI spec already implicit)
- Webhook subscriptions for fills / resolutions
- Documented bot SDK (`@crossbar/bots` package, externalized)
- Strategy marketplace (run/share bots)

### Watchlist + alerts
- Star a market, get notified on price moves / resolution
- Price alerts (YES crosses 70¢)
- Daily summary of watched markets

---

## Phase 7 — Real money (the original Phase 4)

This is a serious fork. Most projects that get here either raise capital and
go regulated, or move offshore and stay crypto-native. There's no middle path.
**Make this decision before writing any of this code.**

### Crypto-native path (Polymarket model)
- USDC integration via Privy embedded wallets
- Off-chain order matching, on-chain settlement
- Smart contract for outcome share tokens (CTF-style)
- Geo-block US users (Polymarket got fined $1.4M for not blocking earlier)
- KYC for >$10k accumulated activity (FATF threshold)
- Operate from a non-US jurisdiction
- Faster to launch but legally gray; expect investigations eventually

### Regulated path (Kalshi model)
- File as a Designated Contract Market with CFTC
- $2–5M legal spend, 2–3 year approval cycle
- Required: capital reserves, surveillance system, compliance officer
- Constrained product (no sports for a long time post-launch)
- Bigger long-term ceiling; brutal to get there alone

### Both paths need
- KYC via Persona, Stripe Identity, or Onfido
- 2FA enforced for any account with real money
- Anti-money-laundering (AML) transaction monitoring
- Tax reporting (1099s in the US)
- Insurance for custody risk
- Dispute resolution process
- Terms of service, privacy policy reviewed by counsel
- Trademark "Crossbar"
- Real customer support workflow

---

## Phase 8 — Scale (only if real money + traction)

Premature without Phase 7 + actual users. Listed for completeness.

### Rust matching engine
- The cutover already separated the API from the engine
- Port `packages/engine` to Rust, expose via gRPC or shared memory
- 10–100x throughput per matcher instance
- Easier multi-process scale-out

### Database scale
- PG read replicas for the API's read-heavy paths
- Active-passive failover
- Partitioning Trade/Order tables by month
- ClickHouse or Timescale for analytics (calibration queries)

### Multi-region
- API + matcher in EU + Asia regions
- CDN for web (Cloudflare, Vercel Edge)
- Latency-routed DNS

### Horizontal matcher
- Multiple matcher instances, one per market (or shard by market id)
- Redis stream consumer groups already support this

---

## Side quests (parallel to phases, no blocking)

### Research + analytics
- More bot strategies: Kelly criterion sizing, RL agent, ensemble
- Historical: market price vs Pinnacle close (when you can scrape it)
- Public dataset export for academic research (anonymized)
- Calibration over time charts (is the platform getting more accurate?)
- "Wisdom of crowds" essay / blog content from your own data

### Internal tooling
- Better admin dashboard (bulk market creation, batch resolution)
- Replay mode: rewind a market to inspect order flow
- Trade auditor: assert wallet/position consistency across all users
- Synthetic load generator (separate from the maker bots)

### Content + marketing (if going commercial)
- Newsletter: weekly market resolution recaps + insights
- X presence (lots of sports + prediction market accounts to engage)
- Discord community
- Streamer integrations (overlay for Twitch streamers)
- Podcast appearances

---

## Decision forks — make these explicitly before Phase 7

- **Personal project vs product for others** — "See if I can build it" got you
  here. To get further, decide whether you want users. Each direction implies
  different priorities.
- **Play money vs real money** — Real money is ~10x the engineering work and
  ~100x the legal work. The play-money product is the moat for a real-money
  product anyway: proven calibration, real liquidity, retained users.
- **Solo vs raise/hire** — Real money path almost certainly requires hiring
  (compliance, legal, 24/7 ops). Crypto-native path can be smaller team but
  still 2–3 people.
- **US vs international** — US sports → US users → US regulations. Going
  international first sidesteps US regulatory risk; you compete with Betfair +
  Smarkets + Polymarket in soccer/tennis.

---

## Where I'd prioritize

**If you don't know what you want this to become yet:**
1. Finish Phase 3 (player props + in-game)
2. Do Phase 4 (operational hardening) so it's deployable
3. Pause and decide: keep as portfolio piece, or push to users?

**If you want this to be a real product:**
1. Finish Phase 3 + Phase 4 (non-negotiable foundation)
2. Phase 5 (polish) and Phase 6 (growth) in parallel
3. Run play-money beta with real users for 6+ months
4. Use real-user data to decide Phase 7 (regulated vs crypto-native)

**If you're just here for the build:**
1. Player props (interesting data work)
2. Rust matching engine port (Phase 8, but interesting in isolation)
3. More bot strategies (Phase 2.5+ research)
4. Skip phases 4–7 entirely

The roadmap is yours to bend. The phases above are sequenced for the
"real product" path because that's the most demanding ordering; everything
else is a subset.
