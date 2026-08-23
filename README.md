# CraigsNotice

Tell it what you're hunting for. It watches Craigslist and pushes you a
notification the moment a genuinely good deal appears — and it keeps working
when Craigslist changes underneath it.

Built for the **Zero Downtime Hackathon** (Bright Data · Port · SigNoz).

---

## The three technologies

### How did you use Bright Data in your project?

We scrape Craigslist with two AI-built Scraper Studio collectors: one reads a
search results page (post id, title, price, URL, posted date, location), the
other opens each new listing for its description, condition, photo count and
image. Bright Data is the entire data layer — the app derives a Craigslist
search URL from what you're watching for, and every listing that reaches the
agent came through those collectors.

It also keeps itself working, which is the part we care about. Every scraped
row is Zod-validated at the boundary, and when the failure rate crosses 30% we
treat the scraper as broken rather than the data as bad: `bdata scraper heal`
rewrites the selectors from a plain-language prompt built out of the actual
validation error, and the fix passes through Bright Data's own approval gate
before it ships. Craigslist changes its markup and nobody tells you — the
pipeline notices and repairs itself instead of quietly returning nothing.

### How did you use Port in your project?

Port manages the catalog and makes the decisions. Every watch, scraper, scrape
run, listing and deal alert is an entity in Port's Context Lake with real
relations between them, defined by five blueprints checked into the repo as
YAML — so the whole catalog rebuilds from source with `bun run port:sync`, and
Port is where you go to see what the system has been doing.

A Port AI agent judges every listing, twice. First: is this even the thing you
asked for? A Craigslist search for "Mac mini" returns Dell laptops, projectors
and monitors, and a cheap wrong thing is not a deal. Then, only for real
matches: is it genuinely good value — weighing generation, configuration,
condition, age, and what's included, against comparable listings rather than a
blended median. Your thumbs-up/down on an alert is written back onto the Port
entity and fed into the next invocation, so the agent calibrates to you instead
of to a threshold someone hardcoded.

### How did you use SigNoz in your project?

We monitor the whole pipeline as one trace per watch cycle — scrape → validate
→ judge → notify — so any deal alert is traceable back to the exact scrape that
produced it, alongside metrics for throughput, agent latency, failures and
scraper health.

Self-healing is treated as a first-class signal rather than a log line: the
breakage, the plain-language repair prompt and the recovery are all emitted as
severity-tagged events, so a repair is searchable on its own and correlated to
the trace that caught it. And the loop closes — a SigNoz alert on the
`scraper.health` gauge can trigger that repair by itself, so observability
doesn't just watch the pipeline, it fixes it.


## Where the integration code lives

Every integration is behind an interface with a fake, so the whole pipeline
runs offline and each boundary is tested independently.

### Bright Data

| File | What it does |
|---|---|
| `craigsnotice_api/src/services/brightdata/client.ts` | `POST /dca/trigger`, `GET /dca/dataset`, and `heal()`. `fetch` is injected so tests never hit the network. Heal shells out to the CLI, because there is no REST heal endpoint. |
| `craigsnotice_api/src/services/brightdata/delivery.ts` | `ResultDelivery` — polling by default, or a webhook store when Bright Data pushes results back. Callers never know which. |
| `craigsnotice_api/src/services/brightdata/fake.ts` | Records triggers and heals; lets a test queue rows and simulate polling latency. |
| `craigsnotice_api/src/services/parse.ts` | Zod-validates every scraped row and computes the violation rate that drives self-healing. |
| `craigsnotice_api/src/services/ingest.ts` | The scrape cycle: trigger → await delivery → validate → diff on `cl_post_id` → fetch details → upsert. |
| `craigsnotice_api/src/services/ogImage.ts` | Backfills the listing photo when the collector returns none. |
| `craigsnotice_types/src/schemas/brightdata.ts` | The row schemas — including the object-shaped `price` that Scraper Studio actually returns. |
| `craigsnotice_types/src/craigslist/url.ts` | Derives the Craigslist search URL that gets scraped. |

Tests: `brightdata-client`, `delivery`, `parse`, `ingest`, `og-image`,
`webhook-delivery` (44 tests).

### Port

| File | What it does |
|---|---|
| `craigsnotice_api/src/services/port/client.ts` | Token exchange with caching, entity upsert/patch, blueprint upsert, and agent invoke. |
| `craigsnotice_api/src/services/port/sse.ts` | Agent invoke replies with `text/event-stream`, not JSON — this reassembles the chunked `execution` frames and extracts the fenced JSON. |
| `craigsnotice_api/src/services/port/mirror.ts` | Mirrors watches, runs, listings and scrapers into the catalog. Wrapped in `safeMirror`: a Port outage logs and the pipeline continues. |
| `craigsnotice_api/src/services/judgment.ts` | Builds the agent prompt, invokes it, validates the verdict, writes the alert. Includes `buildAgentPrompt`, where the relevance-then-value rules live. |
| `craigsnotice_api/src/services/feedback.ts` | Records a thumbs-up/down and patches it onto the Port entity. |
| `craigsnotice_api/scripts/sync-blueprints.ts` | `bun run port:sync`. Orders blueprints by dependency, because Port rejects one whose relation targets do not exist yet. |
| `port/blueprints/*.yaml` | The five blueprints, version-controlled. |
| `port/agents/deal-agent.md` | The agent's system prompt, kept in the repo so the configuration is reproducible. |
| `craigsnotice_types/src/schemas/agent.ts` | The request and verdict contracts. |
| `craigsnotice_types/src/craigslist/relevance.ts` | The local pre-filter that keeps obvious non-matches from spending agent quota. |

Tests: `port-client`, `port-sse`, `blueprints`, `judgment`, `mirror`,
`feedback` (48 tests).

### SigNoz

| File | What it does |
|---|---|
| `craigsnotice_api/src/otel.ts` | The SDK bootstrap, loaded via `--preload` so instrumentation is up before the app. |
| `craigsnotice_api/src/telemetry/index.ts` | `withSpan` — records the exception and marks the span errored before rethrowing. |
| `craigsnotice_api/src/telemetry/metrics.ts` | The counters, histograms, and the `scraper.health` gauge the alert rule fires on. |
| `craigsnotice_api/src/telemetry/events.ts` | Emits each self-heal event three ways at once: span event, severity-tagged log, counter. |
| `craigsnotice_api/src/routes/hooks.ts` | `/api/v1/hooks/signoz/heal` — the alert webhook that closes the loop, and Bright Data's delivery callback. |
| `signoz/alerts/scraper-degraded.json` | The alert rule. |
| `signoz/dashboards/craigsnotice.json` | Seven-panel dashboard. |

Spans are emitted from `services/ingest.ts`, `services/judgment.ts`,
`services/scheduler.ts` and `services/notify/dispatcher.ts`, all under `craigsnotice_api/src/` —
search for `withSpan(`.

Tests: `telemetry`, `metrics`, `events`, `trace-tree` (15 tests). `trace-tree`
runs a real cycle through an in-memory exporter and asserts the tree shape
rather than trusting it.

### Shared by all three

| File | What it does |
|---|---|
| `craigsnotice_api/src/services/scheduler.ts` | `runWatchCycle` — the orchestration that ties scraping, judging and notifying together, and the interval loop that runs watches unattended. |
| `craigsnotice_api/src/services/selfheal.ts` | The detection → degrade → heal → recover chain, touching all three: Zod violation rate (Bright Data), entity patch (Port), event emission (SigNoz). |
| `craigsnotice_api/src/services/fixtures.ts` | Fake Bright Data and Port for `DEMO_MODE=fixtures`, backed by a verbatim capture of a live run. |
| `craigsnotice_api/src/index.ts` | The composition root: where every real or fake client is chosen and wired. |

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

### The Bright Data CLI is a runtime dependency, not just a setup step

Self-healing has no REST endpoint — `POST /dca/collector/:id/heal` returns 404 —
so the API shells out to `bdata scraper heal`. **The `bdata` binary must be on
the PATH of the process running the API**, not just on the machine. Without it
everything works until a scraper breaks, and then the repair fails with
`command not found` instead of healing.

The API checks this at boot and prints a warning if it cannot find `bdata`, so
you learn about it on startup rather than mid-demo. `DEMO_MODE=fixtures` never
shells out, so the check is skipped there.

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

If the API logs `bdata CLI not found on PATH`, self-healing will not work.
Everything else will.

There is no Claude Code or Anthropic dependency: the LLM judgment runs inside
Port's own agent runtime, so the only external binary the API needs is `bdata`.

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
