# CraigsNotice — Design Spec

**Date:** 2026-08-22
**Event:** Zero Downtime Hackathon (Bright Data · Port.io · SigNoz · WeMakeDevs), Bright Data SF
**Repo:** `~/projects/zerodowntime` (monorepo, Bun workspaces)

---

## 1. Product

CraigsNotice watches Craigslist for the thing you want and pushes you a notification when a
genuinely good deal appears.

A user logs in, picks a **location**, a **category**, types what they're **looking for**
("Mac Studio"), and optionally sets a target price. The system derives the Craigslist search
URL, scrapes it on an interval, fetches each new listing's detail page, builds a price
baseline, asks an agent whether each listing is a good deal, and notifies on the ones that are.

The user gives 👍/👎 on each alert. That feedback flows into the next agent invocation, so the
system's notion of "good deal" calibrates to the person using it.

## 2. Hackathon alignment

The event requires three technologies. Each maps to a load-bearing part of the system, not a
veneer.

| Tech | Role |
|---|---|
| **Bright Data Scraper Studio** | Two collectors — Craigslist search-results and listing-detail. Trigger/poll pipeline, Zod-validated output, self-heal on schema drift. |
| **Port** | Context Lake catalog for every domain object, and the runtime that judges deals via `POST /v1/agent/:id/invoke`. |
| **SigNoz** | OpenTelemetry traces, metrics and logs across the whole pipeline; auto-repair events are first-class signals; a SigNoz alert closes the loop by triggering a heal. |

Judging bullets and where they are answered:

- *Faithfulness to requirements* — the watch's derived URL and the agent's structured verdict
  contract are both pure, tested functions (§6, §9).
- *Agent coordination and human decision-making* — §9 feedback loop.
- *Testing and verification* — §12, plus Zod validation of every scraped row.
- *Failure handling and adaptability* — §10 self-heal chain.
- *Operational visibility and repeatability* — §8 Port blueprints as version-controlled YAML,
  §11 SigNoz coverage.
- *Reusable, version-controlled configurations* — `port/blueprints/*.yaml`,
  `brightdata/collectors/*`.
- *Auto-detection and recovery from website changes* — §10.
- *Fresh, structured data output* — §7 pipeline.
- *First-class signal treatment for auto-repair events, feedback loops into the factory* — §11.

## 3. Decisions taken (and what they close off)

| Decision | Chosen | Rejected |
|---|---|---|
| App platform | Vite + React web app | React Native (native push undemoable in one day) |
| Observability depth | Full closed loop: instrument + alert → heal | Dashboard-only, traces-only |
| Port depth | Agent runner + catalog; human decision via in-app feedback | Port workflows / Port manual-approval actions |
| Agent runtime | Port custom agent judges; API does all I/O | Claude Agent SDK locally; both |
| Deal logic | Market baseline + optional target price + feedback | Target price only; pure LLM judgment |
| BD delivery | Polling, with a webhook adapter behind an interface | Webhook via tunnel; both simultaneously |
| Packages | Five, incl. `craigsnotice_types` | Four; duplicated types |
| Reference data | All US sites + all for-sale categories | Top-60 metros; all Craigslist sections |
| Push | FCM Web Push **and** in-app SSE feed | FCM only; in-app only |
| Self-heal trigger | Synthetic, clearly labeled; chain is real | Staged break against a local mirror; manual heal |
| Prep scope | Scaffold + reference data + specs now; pipeline on the day | Specs only; build everything now |

**Honesty note on self-heal.** The detection → event → heal → recovery chain is real code
running against the real Bright Data heal API. Only the *break* is injected, via a dev-only
endpoint. The README states this plainly so that "is that real?" has a clean answer.

## 4. Package layout

`~/projects/zerodowntime` — one git repo, Bun workspaces, scope `@craigsnotice/*`,
internal deps `workspace:*`, nothing published to npm.

| Package | Single responsibility |
|---|---|
| `craigsnotice_types` | Shared types, Zod schemas, response envelope, Craigslist city + category tables, pure URL derivation, haversine nearest-site |
| `craigsnotice_api` | Hono on Bun. Watch CRUD, scheduler, Bright Data client, Port client, deal pipeline, notifications, OTel bootstrap |
| `craigsnotice_client` | `CraigsnoticeClient` class + React Query hooks. Injected `NetworkClient`; no direct `fetch` |
| `craigsnotice_lib` | Business-logic hooks, Zustand store, localStorage (draft watch, geo permission, seen alerts) |
| `craigsnotice_app` | Vite + React + Tailwind, `@sudobility/building_blocks` + `@sudobility/mail_box_components` |

Dependency direction is strictly one-way:

```
types  ←  api
types  ←  client  ←  lib  ←  app
```

`api` never imports `client`. `lib` never imports `app`.

Conventions follow the sudojo family: Bun only, TypeScript strict, Zod validation, Prettier
(double quotes, 80 cols, 2 spaces), ESLint with `^_` unused-var exemption, thin route handlers
with logic in services, `successResponse()` / `errorResponse()` envelope.

Ports: API **8022**, app **5173**, Postgres database `craigsnotice`.

## 5. Data model (PostgreSQL + Drizzle)

```
users            id, firebase_uid UNIQUE, email, fcm_tokens text[], created_at
watches          id, user_id, site_code, subarea, category_code, query,
                 target_price numeric NULL, interval_sec int DEFAULT 300,
                 status enum(active|paused), search_url, created_at
scraper_configs  id, kind enum(search|detail), bd_collector_id,
                 health enum(healthy|degraded), violation_rate numeric,
                 last_healed_at, heal_prompt text NULL
scrape_runs      id, watch_id, scraper_config_id, snapshot_id,
                 status enum(collecting|ready|failed), row_count, violation_count,
                 started_at, finished_at, error text NULL
listings         id, watch_id, cl_post_id UNIQUE, title, price numeric, url,
                 posted_at, location, condition, description, image_count,
                 detail_fetched_at, first_seen_at
deal_alerts      id, listing_id, watch_id, score int, is_good_deal bool,
                 reasoning text, price_vs_median numeric, notified_at, created_at
alert_feedback   id, alert_id, user_id, verdict enum(good|bad), created_at
```

Tables are created idempotently by `bun run db:init` (forward-only
`ALTER TABLE ... ADD COLUMN IF NOT EXISTS`), matching sudojo_api.

`listings.cl_post_id` is the dedup key — Craigslist post ids are stable and globally unique,
so re-scraping the same search never double-inserts and never re-alerts.

## 6. Craigslist reference data and URL derivation

Lives in `craigsnotice_types` so the app's dropdowns and the API's derivation read the same
source. Duplicating it would drift within hours.

- `sites.json` — ~400 US Craigslist sites as `{ code, name, state, lat, lng, subareas[] }`.
  Subareas where they exist (`sfbay` → `sfc`, `sby`, `eby`, `pen`, `nby`).
- `categories.json` — ~40 for-sale category codes (`sss`, `sya`, `ele`, `msg`, `bik`, …) with
  display labels.

Two pure functions, both table-driven-tested:

```ts
buildCraigslistSearchUrl({ siteCode, subarea?, categoryCode, query }): string
// → https://sfbay.craigslist.org/search/sya?query=Mac+Studio
// (canonical subdomain form; stabler than the /search/area/<site>?cat= form)

nearestSite(lat, lng): Site   // haversine over sites.json
```

Geolocation path: browser `navigator.geolocation` → `nearestSite()` → preselect the dropdown.
Permission denial falls back to manual selection; it is never a hard failure.

## 7. Pipeline

### 7.1 Watch creation

```
POST /api/v1/watches   (Firebase ID token)
  → Zod-validate body
  → buildCraigslistSearchUrl(...)
  → INSERT watches
  → PortClient.upsertEntity('craigsnotice_watch', ...)
  → enqueue an immediate run, then schedule every interval_sec
```

### 7.2 Scrape cycle, per watch

```
scheduler tick
  → BrightDataClient.trigger(SEARCH_COLLECTOR, [{ url: watch.search_url }])
      POST https://api.brightdata.com/dca/trigger?collector=<id>&queue_next=1
      Authorization: Bearer <BRIGHTDATA_API_TOKEN>
  → snapshot_id  →  INSERT scrape_runs (status=collecting)  →  mirror to Port
  → ResultDelivery.await(snapshot_id)
      PollingDelivery: GET /dca/dataset?id=<snapshot_id> every 5s until an array is returned
      (typical 30–90s for 1–10 URLs)
  → Zod-validate each row against SearchResultRow  →  violationRate
      if violationRate > 0.3  →  §10 self-heal chain, abort this cycle
  → diff scraped post ids against listings  →  new ids only
  → BrightDataClient.trigger(DETAIL_COLLECTOR, newUrls)  →  await  →  upsert listings
  → recompute the watch's price baseline
```

### 7.3 Price baseline

Over the watch's listings from the trailing 30 days, with rows lacking a price excluded:

```ts
{ count, median, p25, min, max }
```

Below `MIN_BASELINE_SAMPLES` (default 5) the baseline is returned as `null` and the agent is
told to judge on `targetPrice` and world knowledge alone. This is the cold-start path and it
must work on the first run of a brand-new watch — that is what a judge will see.

### 7.4 Judgment

For each new listing:

```
POST https://api.port.io/v1/agent/{DEAL_AGENT_ID}/invoke
Authorization: Bearer <port access token>

{
  listing:       { title, price, condition, description, imageCount, postedAt, location },
  baseline:      { count, median, p25, min, max } | null,
  targetPrice:   number | null,
  recentFeedback: [ { title, price, priceVsMedian, verdict } ]   // last 10 for this watch
}
```

Response contract, Zod-validated on receipt:

```ts
{ isGoodDeal: boolean, score: number /* 0–100 */, reasoning: string, priceVsMedian: number }
```

A malformed or timed-out agent response is not fatal: the listing is stored, no alert is
raised, `agent.invoke` is recorded as a failed span, and the `agent.failures` counter
increments. The pipeline degrades to a data collector rather than stalling.

### 7.5 Notification

`isGoodDeal` → `INSERT deal_alerts` → mirror to Port → `NotificationDispatcher.dispatch()`,
which fans out to both channels:

- **FCM Web Push** — service worker + VAPID, to every token on the user record.
- **SSE** — `GET /api/v1/alerts/stream`, so the alert appears in the open app instantly
  whether or not notification permission was granted.

Both channels are one dispatcher and both emit spans. The SSE path is deliberate insurance:
Chrome silently suppresses notifications in some presentation configurations, and the push is
the payoff moment of the demo.

## 8. Port integration

Auth: `POST https://api.port.io/v1/auth/access_token` with `{ clientId, clientSecret }` →
bearer token, cached until expiry.

Blueprints as version-controlled YAML under `port/blueprints/`, applied by
`bun run port:sync`:

| Blueprint | Key properties |
|---|---|
| `craigsnotice_watch` | site, category, query, targetPrice, status, searchUrl, owner |
| `craigsnotice_scraper_config` | kind, collectorId, health, violationRate, lastHealedAt |
| `craigsnotice_scrape_run` | snapshotId, status, rowCount, violationCount, duration |
| `craigsnotice_listing` | title, price, url, postedAt, condition |
| `craigsnotice_deal_alert` | score, isGoodDeal, reasoning, priceVsMedian, userFeedback |

Relations: `scrape_run → watch`, `scrape_run → scraper_config`, `listing → watch`,
`deal_alert → listing`, `deal_alert → watch`.

`PortClient` is an interface — `getToken`, `upsertEntity`, `patchEntity`, `invokeAgent` — with
a `FakePortClient` so the whole pipeline runs offline.

## 9. The human feedback loop

This is where human decision-making enters, and it is the demo's second beat.

```
User taps 👍/👎 on an alert
  → POST /api/v1/alerts/:id/feedback  { verdict }
  → INSERT alert_feedback
  → PortClient.patchEntity('craigsnotice_deal_alert', id, { userFeedback: verdict })
  → next agent invocation for that watch carries the last 10 feedback items
```

Three thumbs-down on listings priced just under the median visibly tightens the agent's
threshold on the following run. The loop is short enough to show live.

## 10. Self-healing

**Detection.** Every scraped row is Zod-validated. `violationRate = violations / rows`.
Above 0.3, the scraper is considered broken rather than the data considered bad.

**Chain.**

```
violationRate > 0.3
  → UPDATE scraper_configs SET health='degraded', violation_rate=...
  → PortClient.patchEntity('craigsnotice_scraper_config', id, { health: 'degraded' })
  → emit span event + log record: scraper.selfheal.triggered
       attributes: collectorId, violationRate, sampleViolation, healPrompt
  → BrightDataClient.heal(collectorId, healPrompt)
       plain-language prompt, e.g. "The price and posting-date fields are no longer
       extracted. Re-derive selectors for price, title, post date and post id."
  → on success: health='healthy', Port entity patched back,
                emit scraper.selfheal.succeeded, re-run the aborted cycle
  → on failure: emit scraper.selfheal.failed at ERROR severity; watch stays paused
```

**Trigger for the demo.** `POST /api/v1/debug/inject-scrape-failure` — gated on
`NODE_ENV !== 'production'` and a `x-debug-token: $DEBUG_TOKEN` header, and documented in the
README as staged. It corrupts
the next parse so the real chain above runs end to end. The break is synthetic; nothing else
about the chain is.

## 11. Observability (SigNoz)

`craigsnotice_api/src/otel.ts`, preloaded via `--require`. Service name `craigsnotice-api`.
Cloud endpoint `https://ingest.<region>.signoz.cloud:443` with the
`signoz-ingestion-key` header; self-hosted swaps the endpoint and drops the header.

**Traces.** One trace per watch tick:

```
watch.tick
├── scrape.trigger
├── scrape.poll            (one span per poll iteration)
├── scrape.parse           → violationRate attribute
├── listing.detail.fetch   (one per batch)
├── baseline.compute
├── agent.invoke           (one per listing)
└── alert.notify           → channel=fcm|sse
```

Every span carries `watch.id`, `run.id`, `listing.id` where applicable, so a single alert is
traceable back to the scrape that produced it.

**Metrics.** Counters `listings.ingested`, `alerts.sent`, `agent.invocations`,
`agent.failures`, `scrape.violations`, `selfheal.events`. Histograms `agent.latency`,
`scrape.duration`. Gauge `scraper.health` (1 healthy / 0 degraded).

**Auto-repair as a first-class signal.** The three `scraper.selfheal.*` events are emitted as
both span events and severity-tagged log records carrying the heal prompt, so the repair is
searchable, alertable, and readable in isolation from ordinary traffic.

**Loop back into the factory.** A SigNoz alert rule on `scraper.health == 0` posts to
`POST /api/v1/hooks/signoz/heal`, which runs the heal and flips the Port
`craigsnotice_scraper_config` entity back to healthy. Observability does not merely watch the
pipeline; it repairs it.

## 12. Testing

| Package | Coverage |
|---|---|
| `types` | `buildCraigslistSearchUrl` table-driven cases (subareas, query escaping, category codes); `nearestSite` haversine; integrity of `sites.json` / `categories.json` (unique codes, valid lat/lng ranges, no empty labels) |
| `api` | Unit: baseline math incl. the cold-start `null` path, violation-rate detector at threshold boundaries, deal gating, scheduler tick logic. Integration: full pipeline against `FakeBrightDataClient` + `FakePortClient`, including the self-heal chain |
| `client` | Hook tests, happy-dom, mocked `NetworkClient` |
| `lib` | Store and persistence hooks |
| `app` | Smoke tests on the watch-create form and alert feed |

**`DEMO_MODE=fixtures`** runs the entire pipeline from saved fixtures with zero network calls.
This is the fallback if hackathon wifi, Bright Data, or Port is unavailable at demo time, and
it doubles as the integration-test substrate.

## 13. App

Routes: `/login` · `/watches` (list + create) · `/watches/:id` · `/alerts` (live feed).

Create-watch form:

- **Location** — searchable dropdown over ~400 sites, plus a "Use my location" button
  (`navigator.geolocation` → `nearestSite()`).
- **Category** — ~40 for-sale codes.
- **Looking for** — free text.
- **Alert me under $** — optional.

Watch rows show a **Run now** button that forces a scheduler tick — 300s is a realistic
interval but far too slow for a four-minute demo.

Alert cards show price, delta vs median, the agent's reasoning, and 👍/👎.

Auth is Firebase, via `AppTopBarWithFirebaseAuth` from `@sudobility/building_blocks`. Forms
and cards come from `@sudobility/mail_box_components`.

## 14. Environment

```
DATABASE_URL                  postgres://.../craigsnotice
PORT                          8022
FIREBASE_PROJECT_ID / _CLIENT_EMAIL / _PRIVATE_KEY
FIREBASE_VAPID_KEY            web push
BRIGHTDATA_API_TOKEN
BRIGHTDATA_SEARCH_COLLECTOR
BRIGHTDATA_DETAIL_COLLECTOR
PORT_CLIENT_ID / PORT_CLIENT_SECRET
PORT_DEAL_AGENT_ID
OTEL_EXPORTER_OTLP_ENDPOINT   https://ingest.<region>.signoz.cloud:443
OTEL_EXPORTER_OTLP_HEADERS    signoz-ingestion-key=<key>
OTEL_SERVICE_NAME             craigsnotice-api
DEBUG_TOKEN                   guards /api/v1/debug/* ; dev only
DEMO_MODE                     live | fixtures
WATCH_DEFAULT_INTERVAL_SEC    300
MIN_BASELINE_SAMPLES          5
VIOLATION_RATE_THRESHOLD      0.3
```

A dedicated Firebase project is used rather than reusing an existing sudobility one, so
hackathon credentials can be shared or revoked freely.

## 15. Scope split: before the event vs. on the day

**Before (setup only):** workspaces, tsconfigs, lint/format config; `sites.json` and
`categories.json`; `buildCraigslistSearchUrl` and `nearestSite` with tests; Drizzle schema and
`db:init`; Firebase project and VAPID key; Bright Data, Port and SigNoz accounts; the two
Bright Data collectors created via `bdata scraper create`; this spec and the implementation
plan.

**On the day:** scheduler, `BrightDataClient`, `PortClient`, agent contract and prompt,
baseline math, `NotificationDispatcher`, all OTel instrumentation, the SigNoz alert rule and
webhook, the self-heal chain, the entire UI, and the demo video.

## 16. Out of scope

Non-for-sale Craigslist sections (housing, jobs, gigs) — the price-baseline logic does not
transfer. Native mobile apps. Multi-user sharing of watches. Payment or subscription tiers.
Port workflows and Port manual-approval actions (human decision-making is served by the in-app
feedback loop instead). Production deployment — the API runs on localhost for the hackathon.
