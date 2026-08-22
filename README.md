# CraigsNotice

Tell it what you're hunting for. It watches Craigslist and pushes you a
notification the moment a genuinely good deal appears — and it keeps working
when Craigslist changes underneath it.

Built for the **Zero Downtime Hackathon** (Bright Data · Port · SigNoz).

---

## The three technologies, and what each actually does here

### Bright Data Scraper Studio

Two AI-built collectors, created with `bdata scraper create`:

| Collector | id | Job |
|---|---|---|
| `craigsnotice-search` | `c_mt4uabgk2nmd7ndx42` | Craigslist search results → post id, title, price, url, posted date, location |
| `craigsnotice-detail` | `c_mt4ug26f4tafeboze` | One listing → description, condition, photo count |

The API triggers them over `POST /dca/trigger` and polls `GET /dca/dataset`.
**Every scraped row is Zod-validated at the boundary.** The validated
violation rate is the health signal: above 30% the scraper is considered
broken rather than the data considered bad, which drives the repair loop below.

Self-healing runs through `bdata scraper heal <collector> "<plain-language
prompt>"`, and the prompt is built from the *actual* Zod violation, so the AI
is told which fields stopped extracting rather than "something broke".

### Port

Port is both the catalog and the judgment runtime.

- **Context Lake** — five blueprints (`craigsnotice_watch`,
  `craigsnotice_scraper_config`, `craigsnotice_scrape_run`,
  `craigsnotice_listing`, `craigsnotice_deal_alert`), checked in as YAML under
  `port/blueprints/` and applied with `bun run port:sync`. Watches, runs,
  listings, alerts and scraper health all mirror into it live.
- **Deal agent** — `POST /v1/agent/craigsnotice_deal_agent/invoke` decides
  whether each listing is a good deal. It receives the listing, a rolling
  price baseline for that watch, the buyer's target price, and **the buyer's
  last ten thumbs-up/down verdicts**, and returns
  `{isGoodDeal, score, reasoning, priceVsMedian}`.
- **Human decision-making** — 👍/👎 on an alert is written to Postgres, patched
  onto the Port `craigsnotice_deal_alert` entity as `userFeedback`, and fed
  into the next invocation. The agent's bar visibly moves.

Port mirroring is wrapped in `safeMirror`: a Port outage logs and the pipeline
keeps running. The catalog is a catalog, never a dependency.

### SigNoz

OpenTelemetry traces, metrics and logs, exported over OTLP.

- **One trace per watch tick.** `watch.tick` is the root; `scrape.trigger`,
  `scrape.poll`, `scrape.parse`, `listing.detail.fetch`, `baseline.compute`,
  `agent.invoke` and `alert.notify` all descend from it, so any alert is
  traceable back to the scrape that produced it. Asserted in
  `tests/trace-tree.test.ts`, not just hoped for.
- **Metrics** — `listings.ingested`, `alerts.sent`, `agent.invocations`,
  `agent.failures`, `scrape.violations`, `selfheal.events`, histograms for
  agent latency and scrape duration, and a `scraper.health` gauge labelled
  `scraper_config_id` / `collector_id`.
- **Auto-repair as a first-class signal.** Each `scraper.selfheal.*` event
  lands three ways at once: a span event inside the trace that detected it, a
  severity-tagged log record carrying the heal prompt (WARN → INFO, or ERROR
  if the heal fails), and a counter.
- **The loop closes.** A SigNoz alert on `scraper.health == 0`
  (`signoz/alerts/scraper-degraded.json`) posts to
  `POST /api/v1/hooks/signoz/heal`, which runs a real heal. Observability
  doesn't just watch the pipeline — it repairs it.

  That endpoint triggers a billable heal against a live scraper, so it
  requires a shared secret in `x-signoz-token` (constant-time compared) and
  the route is **not mounted at all** unless `SIGNOZ_WEBHOOK_SECRET` is set.
  Set it before exposing the API through a tunnel.

---

## About the staged break

The self-heal **detection, event emission, Bright Data heal call, and
recovery are all real** and run against the live Bright Data API.

The *break* is staged. `POST /api/v1/debug/inject-scrape-failure` (dev-only,
`x-debug-token`-gated) forces the next parse to report a total schema
violation, because Craigslist will not change its DOM on cue during a
four-minute demo. Everything downstream of that injection is the production
code path — the same code that would run if Craigslist really did change.

---

## Architecture

```
Create watch  → POST /api/v1/watches (Firebase ID token)
              → buildCraigslistSearchUrl({site, subarea, category, query})
              → persist → mirror to Port → schedule

Scrape cycle  → trigger search collector → poll snapshot
              → Zod-validate every row → violation rate
              → diff on cl_post_id (a re-scrape never re-alerts)
              → trigger detail collector for new listings only
              → recompute the watch's rolling price baseline

Judgment      → Port agent: listing + baseline + target price + recent feedback
              → {isGoodDeal, score, reasoning, priceVsMedian}
              → good deal → DealAlert → Port → FCM web push + SSE

Feedback      → 👍/👎 → Postgres + Port entity → next agent invocation
```

### Packages

| Package | Responsibility |
|---|---|
| `craigsnotice_types` | Shared types, Zod schemas, 413 Craigslist sites + 46 categories, URL derivation, nearest-site geo |
| `craigsnotice_api` | Hono on Bun. Watches, scheduler, Bright Data, Port, judgment, notifications, OTel |
| `craigsnotice_client` | Typed API client + React Query hooks over an injected `NetworkClient` |
| `craigsnotice_lib` | Geolocation, alert stream, persisted form draft |
| `craigsnotice_app` | Vite + React 19 + Tailwind |

The Craigslist reference data is generated from Craigslist's own
`reference.craigslist.org/Areas` API (`bun run scripts/generate-sites.ts`) —
413 US sites with real coordinates and subareas. Category codes were each
verified against live search URLs.

---

## Setup

```bash
bun install

createdb craigsnotice
cd craigsnotice_api && cp .env.example .env   # fill in credentials
bun run db:init
bun run port:sync                              # applies the five blueprints
```

Create the two collectors (once):

```bash
npm i -g @brightdata/cli && bdata login

bdata scraper create "https://sfbay.craigslist.org/search/sya?query=Mac+Studio" \
  "Extract every search result: post_id, title, price, url, posted_at, location"

bdata scraper create "<a real listing url>" \
  "Extract post_id, title, price, url, description, condition, image_count, posted_at, location"
```

Put the returned collector ids in `BRIGHTDATA_SEARCH_COLLECTOR` and
`BRIGHTDATA_DETAIL_COLLECTOR`, and register them:

```sql
INSERT INTO scraper_configs (kind, bd_collector_id)
VALUES ('search','<search id>'), ('detail','<detail id>');
```

## Running

```bash
cd craigsnotice_api && bun run dev     # :8022
cd craigsnotice_app && bun run dev     # :5173
```

### Firebase

The API needs a service-account credential (`FIREBASE_PROJECT_ID`,
`FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`) from Firebase Console →
Project settings → Service accounts. **These are real secrets** and live only
in the gitignored `craigsnotice_api/.env`.

The app needs the web config (`VITE_FIREBASE_*`) from Project settings → Your
apps. That config is public — it ships inside the client bundle — but it is
still read from env so the repo carries no project-specific values.

Two things must be turned on in the Firebase Console before the app fully
works:

1. **Authentication → Sign-in method → Google** must be enabled, and
   `localhost` must be listed under Authorized domains.
2. **Cloud Messaging → Web Push certificates → Generate key pair**, and put
   the result in `VITE_FIREBASE_VAPID_KEY`. Without it the "Enable
   notifications" button reports that alerts will show in-app, and the SSE
   feed carries them instead.

Without `FIREBASE_PROJECT_ID` the API accepts any bearer token so the pipeline
can be exercised before Firebase is provisioned. It refuses to do this when
`NODE_ENV=production`.

### A note on the SSE stream

`EventSource` cannot set an `Authorization` header. Rather than put the
Firebase ID token in the query string — where a reusable, hour-long credential
would land in access logs, proxy logs and browser history — the client
exchanges it at `POST /api/v1/alerts/stream/ticket` for an opaque ticket that
is single-use, expires in 30 seconds, and is bound to one user. Only that
ticket appears in the URL.

## Tests

```bash
bun run test        # every package
bun run typecheck
```

The API tests need `createdb craigsnotice_test`. They run sequentially because
they share that database.

## Offline mode

```bash
DEMO_MODE=fixtures bun run start
```

Swaps only the two external boundaries — Bright Data and Port — for fixtures
captured verbatim from a live run. Ingest, baseline, judgment, alerts,
notifications, spans, metrics and the self-heal chain are all the same code.
It boots with no third-party credentials at all.
