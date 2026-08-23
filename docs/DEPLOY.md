# Deploying craigsnotice_api

Built and deployed the same way as the other Sudobility services: a Docker
image from this repo, added to a host with `sudobility_dockerized`, with all
configuration coming from Doppler.

## Building

The image builds from the **monorepo root**, not from `craigsnotice_api/`:

```bash
docker build -t craigsnotice_api .
```

`craigsnotice_api` depends on `@craigsnotice/types` through a `workspace:*`
link, so the build context has to contain the workspace root. The Dockerfile
copies all five workspace manifests (`bun install` refuses to run with one
missing) but only ships the source of the two packages the API actually needs.
The frontend packages are excluded by `.dockerignore`.

The image also installs the **Bright Data CLI**, because self-healing has no
REST endpoint and shells out to `bdata scraper heal`. It needs no `bdata
login`: the CLI authenticates from `BRIGHTDATA_API_KEY`, so the image carries
no credentials.

## Environment variables

Everything below goes in Doppler. `add.sh` reads `PORT` from the fetched
secrets to configure Traefik and **aborts if it is missing**.

### Required — the service will not work without these

| Variable | Notes |
|---|---|
| `PORT` | `8022`. Required by `sudobility_dockerized`, not just the app. |
| `DATABASE_URL` | `postgres://user:pass@host:5432/craigsnotice` |
| `BRIGHTDATA_API_TOKEN` | Bright Data API key. Also accepted as `BRIGHTDATA_API_KEY`. |
| `BRIGHTDATA_API_KEY` | **Set this too, to the same value.** The CLI reads this name, and the CLI is what performs self-healing. |
| `BRIGHTDATA_SEARCH_COLLECTOR` | Collector id from `bdata scraper create` |
| `BRIGHTDATA_DETAIL_COLLECTOR` | Collector id from `bdata scraper create` |
| `PORT_CLIENT_ID` | Port → Settings → Credentials |
| `PORT_CLIENT_SECRET` | Port → Settings → Credentials |
| `PORT_DEAL_AGENT_ID` | `craigsnotice_deal_agent` |
| `FIREBASE_PROJECT_ID` | Service account, from Firebase Console |
| `FIREBASE_CLIENT_EMAIL` | Service account |
| `FIREBASE_PRIVATE_KEY` | Service account. Keep the literal `\n` escapes; the app unescapes them. |
| `APP_ORIGINS` | Comma-separated browser origins, e.g. `https://craigsnotice.app`. **Without this, CORS blocks the frontend entirely.** |

### Required for observability

| Variable | Notes |
|---|---|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | e.g. `https://ingest.us2.signoz.cloud` |
| `OTEL_EXPORTER_OTLP_HEADERS` | `signoz-ingestion-key=<key>` |
| `OTEL_SERVICE_NAME` | `craigsnotice-api` |

### Optional — sensible defaults, set to change behaviour

| Variable | Default | Notes |
|---|---|---|
| `NODE_ENV` | — | Set to `production`. Disables the debug route and the dev auth fallback. |
| `PUBLIC_BASE_URL` | *(unset)* | The service's public URL. When set, Bright Data pushes finished runs to `/api/v1/hooks/brightdata` instead of the API polling. Set it once deployed. |
| `SIGNOZ_WEBHOOK_SECRET` | *(unset)* | Shared secret for the alert→heal webhook. **The `/api/v1/hooks` route is not mounted without it**, so the SigNoz feedback loop is off until you set it. |
| `WATCH_DEFAULT_INTERVAL_SEC` | `300` | How often a watch checks. Raise it to conserve Port agent quota. |
| `MIN_BASELINE_SAMPLES` | `5` | Priced listings needed before a price baseline exists. |
| `VIOLATION_RATE_THRESHOLD` | `0.3` | Schema-violation rate above which a scraper is treated as broken. |
| `PORT_API_BASE` | `https://api.getport.io/v1` | Override for a non-default Port region. |
| `DEMO_MODE` | `live` | `fixtures` runs the whole pipeline offline from captured data. |
| `DEBUG_TOKEN` | *(unset)* | Guards `/api/v1/debug/*`. Leave unset in production; the routes are disabled under `NODE_ENV=production` regardless. |

### Do not set in production

`DEBUG_TOKEN` and `DEMO_MODE=fixtures` are development affordances. The debug
routes refuse to serve when `NODE_ENV=production`, but there is no reason to
carry the token in a production config.

## Quota warning

The Port agent has a **500 invocation per month** limit on the current plan,
and the API calls it once per candidate listing. A title pre-filter and a
25-per-cycle cap keep this bounded, but several watches on a 5-minute interval
will still consume it. Raise `WATCH_DEFAULT_INTERVAL_SEC` for anything
long-running.

## After deploying

Set `PUBLIC_BASE_URL` to the service's real URL so Bright Data delivers by
webhook rather than the API polling, and point the SigNoz alert rule
(`signoz/alerts/scraper-degraded.json`) at
`https://<host>/api/v1/hooks/signoz/heal` with `SIGNOZ_WEBHOOK_SECRET` as the
`x-signoz-token` header.
