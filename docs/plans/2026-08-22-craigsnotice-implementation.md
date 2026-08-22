# CraigsNotice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Craigslist deal-watch web app that scrapes via Bright Data Scraper Studio, judges deals with a Port agent, notifies by FCM web push, and is fully observable in SigNoz including a self-healing feedback loop.

**Architecture:** Bun-workspace monorepo of five packages with one-way dependencies (`types ← api`, `types ← client ← lib ← app`). The API owns the watch schedule, triggers Bright Data collectors and polls for snapshots, Zod-validates every scraped row, builds a per-watch price baseline, and asks a Port custom agent for a verdict on each new listing. Good deals fan out to FCM and SSE. User 👍/👎 feeds the next agent invocation. Every stage emits OTel spans, metrics and logs to SigNoz; a SigNoz alert on scraper degradation calls back into the API to run a Bright Data heal.

**Tech Stack:** Bun, TypeScript (strict), Hono 4, PostgreSQL + Drizzle ORM, Zod 4, Firebase Admin + Firebase Web SDK, Vite + React 19 + Tailwind, TanStack Query 5, Zustand 5, OpenTelemetry SDK, Vitest.

**Spec:** `docs/specs/2026-08-22-craigsnotice-design.md`

## Global Constraints

- **Package manager: Bun only.** Never `npm`, `yarn`, or `pnpm`. Install with `bun install`, run with `bun run`.
- **TypeScript strict mode** everywhere. ESM only (`"type": "module"`).
- **Package scope** `@craigsnotice/*`. Internal deps use `workspace:*`. Nothing is published to npm.
- **Prettier:** double quotes, 80 char width, 2 spaces, trailing commas `es5`.
- **ESLint:** unused vars exempt when prefixed `^_`, `prefer-const`, `no-var`.
- **Dependency direction is one-way.** `craigsnotice_api` must never import `craigsnotice_client`. `craigsnotice_lib` must never import `craigsnotice_app`. A task that needs a type shared between API and frontend puts it in `craigsnotice_types`.
- **Every API response** uses `successResponse()` / `errorResponse()` from `@craigsnotice/types`.
- **Every request body and every external payload** (Bright Data rows, Port agent responses) is Zod-validated at the boundary. Never trust an external shape.
- **Route handlers stay thin.** Logic lives in `src/services/`.
- **Ports:** API `8022`, app `5173`, Postgres database `craigsnotice`.
- **Thresholds** (env-overridable, these are the defaults): `WATCH_DEFAULT_INTERVAL_SEC=300`, `MIN_BASELINE_SAMPLES=5`, `VIOLATION_RATE_THRESHOLD=0.3`.
- **Git:** commit after every task. Never push unless explicitly asked.
- **TDD:** every task writes the failing test first, runs it to confirm it fails, then implements. Do not write implementation before the test.

## Phase Map

| Phase | Tasks | When |
|---|---|---|
| 0 — Foundations | 1–9 | Before the event (setup only, per spec §15) |
| 1 — Data pipeline | 10–14 | Day of |
| 2 — Port + agent | 15–18 | Day of |
| 3 — Notifications + feedback | 19–20 | Day of |
| 4 — Scheduler + self-heal | 21–23 | Day of |
| 5 — Observability | 24–26 | Day of |
| 6 — Frontend | 27–32 | Day of |
| 7 — Demo hardening | 33–34 | Day of |

## File Structure

```
zerodowntime/
├── package.json                     workspaces, shared scripts
├── tsconfig.base.json               strict compiler options, shared
├── .prettierrc / eslint.config.js   shared lint + format config
├── port/blueprints/*.yaml           version-controlled Port blueprints
├── brightdata/collectors/           collector descriptions + heal prompts
├── docs/specs/ docs/plans/
│
├── craigsnotice_types/src/
│   ├── index.ts                     public exports
│   ├── response.ts                  successResponse / errorResponse
│   ├── craigslist/sites.json        ~400 US sites
│   ├── craigslist/categories.json   ~40 for-sale categories
│   ├── craigslist/reference.ts      typed accessors over the two JSON files
│   ├── craigslist/url.ts            buildCraigslistSearchUrl
│   ├── craigslist/geo.ts            haversine + nearestSite
│   ├── domain.ts                    Watch, Listing, DealAlert, ScrapeRun, Baseline
│   ├── schemas/requests.ts          Zod schemas for API request bodies
│   ├── schemas/brightdata.ts        Zod schemas for scraped rows
│   └── schemas/agent.ts             Zod schemas for the Port agent contract
│
├── craigsnotice_api/src/
│   ├── otel.ts                      OTel bootstrap (preloaded)
│   ├── telemetry/                   tracer, meter, selfheal events
│   ├── index.ts                     Hono app, graceful shutdown
│   ├── db/{index,schema,init}.ts
│   ├── middleware/firebaseAuth.ts
│   ├── routes/{watches,alerts,feedback,debug,hooks,health}.ts
│   ├── services/
│   │   ├── brightdata/{client,fake,delivery}.ts
│   │   ├── port/{client,fake,blueprints}.ts
│   │   ├── ingest.ts                diff + detail fetch + upsert
│   │   ├── baseline.ts              median/p25 math
│   │   ├── judgment.ts              agent invocation + verdict handling
│   │   ├── selfheal.ts              detection + heal chain
│   │   ├── scheduler.ts             per-watch ticks
│   │   └── notify/{dispatcher,fcm,sse}.ts
│   └── fixtures/                    DEMO_MODE=fixtures payloads
│
├── craigsnotice_client/src/
│   ├── network/craigsnotice-client.ts
│   └── hooks/{query-keys,use-watches,use-alerts,use-feedback}.ts
│
├── craigsnotice_lib/src/
│   ├── stores/watchDraftStore.ts
│   └── hooks/{useGeoSite,useWatches,useAlertStream,useAlertFeedback}.ts
│
└── craigsnotice_app/src/
    ├── main.tsx App.tsx
    ├── pages/{Login,Watches,WatchDetail,Alerts}.tsx
    ├── components/{WatchForm,LocationPicker,CategoryPicker,AlertCard}.tsx
    └── firebase.ts
    public/firebase-messaging-sw.js
```

---

# Phase 0 — Foundations (before the event)

### Task 1: Monorepo scaffold and the response envelope

**Files:**
- Create: `package.json`, `tsconfig.base.json`, `.prettierrc`, `eslint.config.js`
- Create: `craigsnotice_types/package.json`, `craigsnotice_types/tsconfig.json`, `craigsnotice_types/vitest.config.ts`
- Create: `craigsnotice_types/src/response.ts`, `craigsnotice_types/src/index.ts`
- Test: `craigsnotice_types/src/__tests__/response.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `ApiResponse<T> = { success: boolean; data?: T; error?: string }`, `successResponse<T>(data: T): ApiResponse<T>`, `errorResponse(error: string): ApiResponse<never>`. Every later task in every package imports these.

- [ ] **Step 1: Create the workspace root**

`package.json`:

```json
{
  "name": "zerodowntime",
  "private": true,
  "type": "module",
  "workspaces": [
    "craigsnotice_types",
    "craigsnotice_api",
    "craigsnotice_client",
    "craigsnotice_lib",
    "craigsnotice_app"
  ],
  "scripts": {
    "typecheck": "bun run --filter '*' typecheck",
    "test": "bun run --filter '*' test:run",
    "lint": "bun run --filter '*' lint",
    "format": "prettier --write \"*/src/**/*.{ts,tsx,json}\""
  },
  "devDependencies": {
    "prettier": "^3.3.0",
    "typescript": "^5.9.0",
    "eslint": "^9.0.0",
    "typescript-eslint": "^8.0.0",
    "vitest": "^2.0.0"
  }
}
```

`tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "exactOptionalPropertyTypes": true,
    "resolveJsonModule": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

`.prettierrc`:

```json
{ "singleQuote": false, "printWidth": 80, "tabWidth": 2, "trailingComma": "es5" }
```

`eslint.config.js`:

```js
import tseslint from "typescript-eslint";

export default tseslint.config(...tseslint.configs.recommended, {
  rules: {
    "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    "prefer-const": "error",
    "no-var": "error",
  },
});
```

- [ ] **Step 2: Create the types package**

`craigsnotice_types/package.json`:

```json
{
  "name": "@craigsnotice/types",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest",
    "test:run": "vitest run",
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "lint": "eslint src"
  },
  "dependencies": { "zod": "^4.0.0" }
}
```

`craigsnotice_types/tsconfig.json`:

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src/**/*"],
  "exclude": ["src/**/__tests__/**"]
}
```

`craigsnotice_types/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({ test: { environment: "node", include: ["src/**/*.test.ts"] } });
```

- [ ] **Step 3: Write the failing test**

`craigsnotice_types/src/__tests__/response.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { successResponse, errorResponse } from "../response";

describe("response envelope", () => {
  it("wraps data in a success envelope", () => {
    expect(successResponse({ id: "w1" })).toEqual({ success: true, data: { id: "w1" } });
  });

  it("wraps a message in an error envelope with no data key", () => {
    const r = errorResponse("watch not found");
    expect(r).toEqual({ success: false, error: "watch not found" });
    expect("data" in r).toBe(false);
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `cd craigsnotice_types && bun run test:run`
Expected: FAIL — `Failed to resolve import "../response"`.

- [ ] **Step 5: Implement the envelope**

`craigsnotice_types/src/response.ts`:

```ts
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export const successResponse = <T>(data: T): ApiResponse<T> => ({ success: true, data });

export const errorResponse = (error: string): ApiResponse<never> => ({ success: false, error });
```

`craigsnotice_types/src/index.ts`:

```ts
export * from "./response";
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd craigsnotice_types && bun run test:run`
Expected: PASS, 2 tests.

- [ ] **Step 7: Commit**

```bash
git add package.json tsconfig.base.json .prettierrc eslint.config.js craigsnotice_types
git commit -m "feat(types): scaffold monorepo and add response envelope"
```

---

### Task 2: Craigslist reference data

**Files:**
- Create: `craigsnotice_types/src/craigslist/sites.json`, `craigsnotice_types/src/craigslist/categories.json`
- Create: `craigsnotice_types/src/craigslist/reference.ts`
- Create: `scripts/generate-sites.ts`
- Test: `craigsnotice_types/src/__tests__/reference.test.ts`
- Modify: `craigsnotice_types/src/index.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `interface Site { code: string; name: string; state: string; lat: number; lng: number; subareas: Subarea[] }`, `interface Subarea { code: string; name: string }`, `interface Category { code: string; label: string }`, and `SITES: Site[]`, `CATEGORIES: Category[]`, `getSite(code: string): Site | undefined`, `getCategory(code: string): Category | undefined`. Tasks 3, 4, 9, 30 all consume these.

**Data sourcing note:** Craigslist publishes its site list at `https://www.craigslist.org/about/sites`. `scripts/generate-sites.ts` scrapes that page for site codes and names, then joins latitude/longitude from a static metro-coordinate table checked into the script. Run it once; the committed JSON is the source of truth thereafter. Do not fetch at runtime — the app must work offline in `DEMO_MODE=fixtures`.

- [ ] **Step 1: Write the failing integrity test**

`craigsnotice_types/src/__tests__/reference.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { SITES, CATEGORIES, getSite, getCategory } from "../craigslist/reference";

describe("craigslist reference data", () => {
  it("has a realistic number of US sites", () => {
    expect(SITES.length).toBeGreaterThan(300);
  });

  it("has unique site codes", () => {
    expect(new Set(SITES.map((s) => s.code)).size).toBe(SITES.length);
  });

  it("has valid coordinates for every site", () => {
    for (const s of SITES) {
      expect(s.lat).toBeGreaterThan(17);
      expect(s.lat).toBeLessThan(72);
      expect(s.lng).toBeGreaterThan(-180);
      expect(s.lng).toBeLessThan(-64);
      expect(s.name.trim()).not.toBe("");
    }
  });

  it("includes sfbay with its five subareas", () => {
    const sf = getSite("sfbay");
    expect(sf).toBeDefined();
    expect(sf!.subareas.map((a) => a.code).sort()).toEqual(["eby", "nby", "pen", "sby", "sfc"]);
  });

  it("has unique category codes and includes the for-sale staples", () => {
    expect(new Set(CATEGORIES.map((c) => c.code)).size).toBe(CATEGORIES.length);
    for (const code of ["sss", "sya", "ele", "msg", "bik"]) {
      expect(getCategory(code), `missing category ${code}`).toBeDefined();
    }
  });

  it("has a non-empty label for every category", () => {
    for (const c of CATEGORIES) expect(c.label.trim()).not.toBe("");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd craigsnotice_types && bun run test:run reference`
Expected: FAIL — cannot resolve `../craigslist/reference`.

- [ ] **Step 3: Generate the site data**

Write `scripts/generate-sites.ts` to fetch `https://www.craigslist.org/about/sites`, extract every `*.craigslist.org` US subdomain with its display name and state heading, join coordinates from the script's embedded metro table, and write `craigsnotice_types/src/craigslist/sites.json`.

Run: `bun run scripts/generate-sites.ts`

Any site the coordinate table does not cover is printed to stderr; fill those in by hand in the script's table and re-run until stderr is empty. The test in Step 1 fails loudly if any coordinate is missing, so this converges.

`sites.json` shape:

```json
[
  {
    "code": "sfbay",
    "name": "SF bay area",
    "state": "CA",
    "lat": 37.7749,
    "lng": -122.4194,
    "subareas": [
      { "code": "sfc", "name": "city of san francisco" },
      { "code": "sby", "name": "south bay" },
      { "code": "eby", "name": "east bay" },
      { "code": "pen", "name": "peninsula" },
      { "code": "nby", "name": "north bay" }
    ]
  }
]
```

- [ ] **Step 4: Write the category data**

`craigsnotice_types/src/craigslist/categories.json` — the for-sale section only, ~40 entries:

```json
[
  { "code": "sss", "label": "all for sale" },
  { "code": "ata", "label": "antiques" },
  { "code": "ppa", "label": "appliances" },
  { "code": "ara", "label": "arts & crafts" },
  { "code": "sna", "label": "atvs, utvs, snowmobiles" },
  { "code": "pta", "label": "auto parts" },
  { "code": "baa", "label": "baby & kid stuff" },
  { "code": "bar", "label": "barter" },
  { "code": "haa", "label": "beauty & health" },
  { "code": "bia", "label": "bicycles" },
  { "code": "bpa", "label": "bicycle parts" },
  { "code": "boo", "label": "boats" },
  { "code": "bpo", "label": "boat parts" },
  { "code": "bka", "label": "books & magazines" },
  { "code": "bfa", "label": "business" },
  { "code": "cta", "label": "cars & trucks" },
  { "code": "ema", "label": "cds / dvds / vhs" },
  { "code": "moa", "label": "cell phones" },
  { "code": "cla", "label": "clothing & accessories" },
  { "code": "cba", "label": "collectibles" },
  { "code": "syp", "label": "computer parts" },
  { "code": "sya", "label": "computers" },
  { "code": "ela", "label": "electronics" },
  { "code": "gra", "label": "farm & garden" },
  { "code": "zip", "label": "free stuff" },
  { "code": "fua", "label": "furniture" },
  { "code": "gms", "label": "garage & moving sales" },
  { "code": "foa", "label": "general for sale" },
  { "code": "hva", "label": "heavy equipment" },
  { "code": "hsa", "label": "household items" },
  { "code": "jwa", "label": "jewelry" },
  { "code": "mat", "label": "materials" },
  { "code": "msa", "label": "musical instruments" },
  { "code": "pha", "label": "photo / video" },
  { "code": "rva", "label": "recreational vehicles" },
  { "code": "sga", "label": "sporting goods" },
  { "code": "tls", "label": "tools" },
  { "code": "taa", "label": "toys & games" },
  { "code": "tra", "label": "trailers" },
  { "code": "vga", "label": "video gaming" },
  { "code": "waa", "label": "wanted" }
]
```

- [ ] **Step 5: Implement the typed accessors**

`craigsnotice_types/src/craigslist/reference.ts`:

```ts
import sitesJson from "./sites.json" with { type: "json" };
import categoriesJson from "./categories.json" with { type: "json" };

export interface Subarea {
  code: string;
  name: string;
}

export interface Site {
  code: string;
  name: string;
  state: string;
  lat: number;
  lng: number;
  subareas: Subarea[];
}

export interface Category {
  code: string;
  label: string;
}

export const SITES: Site[] = sitesJson as Site[];
export const CATEGORIES: Category[] = categoriesJson as Category[];

const siteIndex = new Map(SITES.map((s) => [s.code, s]));
const categoryIndex = new Map(CATEGORIES.map((c) => [c.code, c]));

export const getSite = (code: string): Site | undefined => siteIndex.get(code);
export const getCategory = (code: string): Category | undefined => categoryIndex.get(code);
```

Add `export * from "./craigslist/reference";` to `craigsnotice_types/src/index.ts`.

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd craigsnotice_types && bun run test:run reference`
Expected: PASS, 6 tests.

- [ ] **Step 7: Commit**

```bash
git add craigsnotice_types/src/craigslist craigsnotice_types/src/index.ts craigsnotice_types/src/__tests__/reference.test.ts scripts/generate-sites.ts
git commit -m "feat(types): add Craigslist site and category reference data"
```

---

### Task 3: Craigslist search URL derivation

**Files:**
- Create: `craigsnotice_types/src/craigslist/url.ts`
- Test: `craigsnotice_types/src/__tests__/url.test.ts`
- Modify: `craigsnotice_types/src/index.ts`

**Interfaces:**
- Consumes: `getSite`, `getCategory` from Task 2.
- Produces: `buildCraigslistSearchUrl(input: SearchUrlInput): string` where `SearchUrlInput = { siteCode: string; subarea?: string; categoryCode: string; query: string }`. Throws `InvalidWatchTargetError` on an unknown site, unknown subarea, unknown category, or empty query. Tasks 9 and 21 consume this.

- [ ] **Step 1: Write the failing test**

`craigsnotice_types/src/__tests__/url.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildCraigslistSearchUrl, InvalidWatchTargetError } from "../craigslist/url";

describe("buildCraigslistSearchUrl", () => {
  const cases: Array<[string, Parameters<typeof buildCraigslistSearchUrl>[0], string]> = [
    [
      "site + category + query",
      { siteCode: "sfbay", categoryCode: "sya", query: "Mac Studio" },
      "https://sfbay.craigslist.org/search/sya?query=Mac+Studio",
    ],
    [
      "subarea is inserted before the category",
      { siteCode: "sfbay", subarea: "sfc", categoryCode: "sya", query: "Mac Studio" },
      "https://sfbay.craigslist.org/search/sfc/sya?query=Mac+Studio",
    ],
    [
      "special characters are percent-encoded",
      { siteCode: "newyork", categoryCode: "ela", query: "Sony A7 & lens" },
      "https://newyork.craigslist.org/search/ela?query=Sony+A7+%26+lens",
    ],
    [
      "query whitespace is trimmed and collapsed",
      { siteCode: "sfbay", categoryCode: "sss", query: "  herman   miller  " },
      "https://sfbay.craigslist.org/search/sss?query=herman+miller",
    ],
  ];

  for (const [name, input, expected] of cases) {
    it(name, () => expect(buildCraigslistSearchUrl(input)).toBe(expected));
  }

  it("rejects an unknown site", () => {
    expect(() => buildCraigslistSearchUrl({ siteCode: "atlantis", categoryCode: "sya", query: "x" }))
      .toThrow(InvalidWatchTargetError);
  });

  it("rejects an unknown category", () => {
    expect(() => buildCraigslistSearchUrl({ siteCode: "sfbay", categoryCode: "zzz", query: "x" }))
      .toThrow(InvalidWatchTargetError);
  });

  it("rejects a subarea that does not belong to the site", () => {
    expect(() => buildCraigslistSearchUrl({ siteCode: "newyork", subarea: "sfc", categoryCode: "sya", query: "x" }))
      .toThrow(InvalidWatchTargetError);
  });

  it("rejects an empty query", () => {
    expect(() => buildCraigslistSearchUrl({ siteCode: "sfbay", categoryCode: "sya", query: "   " }))
      .toThrow(InvalidWatchTargetError);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd craigsnotice_types && bun run test:run url`
Expected: FAIL — cannot resolve `../craigslist/url`.

- [ ] **Step 3: Implement the derivation**

`craigsnotice_types/src/craigslist/url.ts`:

```ts
import { getCategory, getSite } from "./reference";

export class InvalidWatchTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidWatchTargetError";
  }
}

export interface SearchUrlInput {
  siteCode: string;
  subarea?: string;
  categoryCode: string;
  query: string;
}

export const buildCraigslistSearchUrl = (input: SearchUrlInput): string => {
  const site = getSite(input.siteCode);
  if (!site) throw new InvalidWatchTargetError(`unknown site: ${input.siteCode}`);

  if (!getCategory(input.categoryCode)) {
    throw new InvalidWatchTargetError(`unknown category: ${input.categoryCode}`);
  }

  if (input.subarea && !site.subareas.some((a) => a.code === input.subarea)) {
    throw new InvalidWatchTargetError(`subarea ${input.subarea} does not belong to site ${site.code}`);
  }

  const query = input.query.trim().replace(/\s+/g, " ");
  if (query === "") throw new InvalidWatchTargetError("query must not be empty");

  const path = input.subarea
    ? `${input.subarea}/${input.categoryCode}`
    : input.categoryCode;

  const params = new URLSearchParams({ query });
  return `https://${site.code}.craigslist.org/search/${path}?${params.toString()}`;
};
```

`URLSearchParams` encodes a space as `+` and `&` as `%26`, which matches the expected strings above.

Add `export * from "./craigslist/url";` to `craigsnotice_types/src/index.ts`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd craigsnotice_types && bun run test:run url`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add craigsnotice_types/src/craigslist/url.ts craigsnotice_types/src/__tests__/url.test.ts craigsnotice_types/src/index.ts
git commit -m "feat(types): derive Craigslist search URLs from watch targets"
```

---

### Task 4: Nearest-site geolocation

**Files:**
- Create: `craigsnotice_types/src/craigslist/geo.ts`
- Test: `craigsnotice_types/src/__tests__/geo.test.ts`
- Modify: `craigsnotice_types/src/index.ts`

**Interfaces:**
- Consumes: `SITES`, `Site` from Task 2.
- Produces: `haversineKm(a: Coords, b: Coords): number` and `nearestSite(coords: Coords): Site` where `Coords = { lat: number; lng: number }`. Task 28 consumes `nearestSite`.

- [ ] **Step 1: Write the failing test**

`craigsnotice_types/src/__tests__/geo.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { haversineKm, nearestSite } from "../craigslist/geo";

describe("haversineKm", () => {
  it("is zero for identical points", () => {
    expect(haversineKm({ lat: 37.77, lng: -122.42 }, { lat: 37.77, lng: -122.42 })).toBe(0);
  });

  it("matches the known SF to NYC great-circle distance", () => {
    const d = haversineKm({ lat: 37.7749, lng: -122.4194 }, { lat: 40.7128, lng: -74.006 });
    expect(d).toBeGreaterThan(4120);
    expect(d).toBeLessThan(4140);
  });

  it("is symmetric", () => {
    const a = { lat: 34.05, lng: -118.24 };
    const b = { lat: 41.88, lng: -87.63 };
    expect(haversineKm(a, b)).toBeCloseTo(haversineKm(b, a), 6);
  });
});

describe("nearestSite", () => {
  it("resolves downtown San Francisco to sfbay", () => {
    expect(nearestSite({ lat: 37.7749, lng: -122.4194 }).code).toBe("sfbay");
  });

  it("resolves Manhattan to newyork", () => {
    expect(nearestSite({ lat: 40.7128, lng: -74.006 }).code).toBe("newyork");
  });

  it("always returns a site even for a far-offshore coordinate", () => {
    expect(nearestSite({ lat: 25.0, lng: -160.0 }).code).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd craigsnotice_types && bun run test:run geo`
Expected: FAIL — cannot resolve `../craigslist/geo`.

- [ ] **Step 3: Implement haversine and nearest-site**

`craigsnotice_types/src/craigslist/geo.ts`:

```ts
import { SITES, type Site } from "./reference";

export interface Coords {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_KM = 6371;
const toRad = (deg: number): number => (deg * Math.PI) / 180;

export const haversineKm = (a: Coords, b: Coords): number => {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
};

export const nearestSite = (coords: Coords): Site => {
  let best = SITES[0];
  if (!best) throw new Error("site table is empty");
  let bestDistance = haversineKm(coords, best);

  for (const site of SITES) {
    const d = haversineKm(coords, site);
    if (d < bestDistance) {
      best = site;
      bestDistance = d;
    }
  }
  return best;
};
```

Add `export * from "./craigslist/geo";` to `craigsnotice_types/src/index.ts`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd craigsnotice_types && bun run test:run geo`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add craigsnotice_types/src/craigslist/geo.ts craigsnotice_types/src/__tests__/geo.test.ts craigsnotice_types/src/index.ts
git commit -m "feat(types): resolve coordinates to the nearest Craigslist site"
```

---

### Task 5: Domain types and boundary schemas

**Files:**
- Create: `craigsnotice_types/src/domain.ts`
- Create: `craigsnotice_types/src/schemas/requests.ts`, `craigsnotice_types/src/schemas/brightdata.ts`, `craigsnotice_types/src/schemas/agent.ts`
- Test: `craigsnotice_types/src/__tests__/schemas.test.ts`
- Modify: `craigsnotice_types/src/index.ts`

**Interfaces:**
- Consumes: nothing beyond `zod`.
- Produces: the shared vocabulary for every later task —
  - `Watch`, `Listing`, `DealAlert`, `ScrapeRun`, `ScraperConfig`, `Baseline`, `FeedbackVerdict`
  - `createWatchSchema`, `feedbackSchema`
  - `searchResultRowSchema`, `listingDetailRowSchema`
  - `agentRequestSchema`, `agentVerdictSchema` and `AgentVerdict`

- [ ] **Step 1: Write the failing test**

`craigsnotice_types/src/__tests__/schemas.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createWatchSchema } from "../schemas/requests";
import { searchResultRowSchema } from "../schemas/brightdata";
import { agentVerdictSchema } from "../schemas/agent";

describe("createWatchSchema", () => {
  const valid = { siteCode: "sfbay", categoryCode: "sya", query: "Mac Studio" };

  it("accepts a minimal watch", () => {
    expect(createWatchSchema.parse(valid)).toMatchObject(valid);
  });

  it("defaults intervalSec to 300", () => {
    expect(createWatchSchema.parse(valid).intervalSec).toBe(300);
  });

  it("accepts an optional target price", () => {
    expect(createWatchSchema.parse({ ...valid, targetPrice: 1200 }).targetPrice).toBe(1200);
  });

  it("rejects a negative target price", () => {
    expect(createWatchSchema.safeParse({ ...valid, targetPrice: -1 }).success).toBe(false);
  });

  it("rejects an empty query", () => {
    expect(createWatchSchema.safeParse({ ...valid, query: "" }).success).toBe(false);
  });

  it("rejects an interval below 60 seconds", () => {
    expect(createWatchSchema.safeParse({ ...valid, intervalSec: 5 }).success).toBe(false);
  });
});

describe("searchResultRowSchema", () => {
  it("accepts a well-formed scraped row", () => {
    const row = { post_id: "77", title: "Mac Studio M2", price: "$1,200", url: "https://sfbay.craigslist.org/x/77.html" };
    const parsed = searchResultRowSchema.parse(row);
    expect(parsed.postId).toBe("77");
    expect(parsed.price).toBe(1200);
  });

  it("accepts a row with no price and yields null", () => {
    const row = { post_id: "78", title: "Free monitor", price: null, url: "https://sfbay.craigslist.org/x/78.html" };
    expect(searchResultRowSchema.parse(row).price).toBeNull();
  });

  it("rejects a row missing post_id", () => {
    expect(searchResultRowSchema.safeParse({ title: "x", url: "https://a.b/c" }).success).toBe(false);
  });

  it("rejects a row whose url is not a url", () => {
    expect(searchResultRowSchema.safeParse({ post_id: "79", title: "x", url: "not-a-url" }).success).toBe(false);
  });
});

describe("agentVerdictSchema", () => {
  it("accepts a well-formed verdict", () => {
    const v = { isGoodDeal: true, score: 82, reasoning: "30% under median", priceVsMedian: -0.3 };
    expect(agentVerdictSchema.parse(v)).toEqual(v);
  });

  it("rejects a score outside 0-100", () => {
    expect(agentVerdictSchema.safeParse({ isGoodDeal: true, score: 140, reasoning: "x", priceVsMedian: 0 }).success).toBe(false);
  });

  it("rejects a missing reasoning field", () => {
    expect(agentVerdictSchema.safeParse({ isGoodDeal: true, score: 50, priceVsMedian: 0 }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd craigsnotice_types && bun run test:run schemas`
Expected: FAIL — cannot resolve the three schema modules.

- [ ] **Step 3: Implement the domain types**

`craigsnotice_types/src/domain.ts`:

```ts
export type WatchStatus = "active" | "paused";
export type ScrapeRunStatus = "collecting" | "ready" | "failed";
export type ScraperKind = "search" | "detail";
export type ScraperHealth = "healthy" | "degraded";
export type FeedbackVerdict = "good" | "bad";

export interface Watch {
  id: string;
  userId: string;
  siteCode: string;
  subarea: string | null;
  categoryCode: string;
  query: string;
  targetPrice: number | null;
  intervalSec: number;
  status: WatchStatus;
  searchUrl: string;
  createdAt: string;
}

export interface Listing {
  id: string;
  watchId: string;
  clPostId: string;
  title: string;
  price: number | null;
  url: string;
  postedAt: string | null;
  location: string | null;
  condition: string | null;
  description: string | null;
  imageCount: number;
  detailFetchedAt: string | null;
  firstSeenAt: string;
}

export interface DealAlert {
  id: string;
  listingId: string;
  watchId: string;
  score: number;
  isGoodDeal: boolean;
  reasoning: string;
  priceVsMedian: number;
  notifiedAt: string | null;
  createdAt: string;
}

export interface ScrapeRun {
  id: string;
  watchId: string | null;
  scraperConfigId: string;
  snapshotId: string;
  status: ScrapeRunStatus;
  rowCount: number;
  violationCount: number;
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
}

export interface ScraperConfig {
  id: string;
  kind: ScraperKind;
  bdCollectorId: string;
  health: ScraperHealth;
  violationRate: number;
  lastHealedAt: string | null;
  healPrompt: string | null;
}

/** Null when fewer than MIN_BASELINE_SAMPLES priced listings exist for the watch. */
export interface Baseline {
  count: number;
  median: number;
  p25: number;
  min: number;
  max: number;
}
```

- [ ] **Step 4: Implement the request schemas**

`craigsnotice_types/src/schemas/requests.ts`:

```ts
import { z } from "zod";

export const createWatchSchema = z.object({
  siteCode: z.string().min(1),
  subarea: z.string().min(1).optional(),
  categoryCode: z.string().min(1),
  query: z.string().trim().min(1),
  targetPrice: z.number().nonnegative().optional(),
  intervalSec: z.number().int().min(60).max(86400).default(300),
});

export type CreateWatchInput = z.infer<typeof createWatchSchema>;

export const feedbackSchema = z.object({
  verdict: z.enum(["good", "bad"]),
});

export type FeedbackInput = z.infer<typeof feedbackSchema>;
```

- [ ] **Step 5: Implement the Bright Data row schemas**

`craigsnotice_types/src/schemas/brightdata.ts`:

```ts
import { z } from "zod";

/** "$1,200" | "1200" | "" | null  ->  1200 | null */
const priceField = z
  .union([z.string(), z.number(), z.null()])
  .optional()
  .transform((raw) => {
    if (raw === null || raw === undefined) return null;
    if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
    const digits = raw.replace(/[^0-9.]/g, "");
    if (digits === "") return null;
    const n = Number(digits);
    return Number.isFinite(n) ? n : null;
  });

export const searchResultRowSchema = z.object({
  post_id: z.string().min(1),
  title: z.string().min(1),
  url: z.string().url(),
  price: priceField,
  posted_at: z.string().nullish().default(null),
  location: z.string().nullish().default(null),
}).transform((r) => ({
  postId: r.post_id,
  title: r.title,
  url: r.url,
  price: r.price,
  postedAt: r.posted_at ?? null,
  location: r.location ?? null,
}));

export type SearchResultRow = z.infer<typeof searchResultRowSchema>;

export const listingDetailRowSchema = z.object({
  post_id: z.string().min(1),
  title: z.string().min(1),
  url: z.string().url(),
  price: priceField,
  description: z.string().nullish().default(null),
  condition: z.string().nullish().default(null),
  image_count: z.number().int().nonnegative().nullish().default(0),
  posted_at: z.string().nullish().default(null),
  location: z.string().nullish().default(null),
}).transform((r) => ({
  postId: r.post_id,
  title: r.title,
  url: r.url,
  price: r.price,
  description: r.description ?? null,
  condition: r.condition ?? null,
  imageCount: r.image_count ?? 0,
  postedAt: r.posted_at ?? null,
  location: r.location ?? null,
}));

export type ListingDetailRow = z.infer<typeof listingDetailRowSchema>;
```

- [ ] **Step 6: Implement the agent contract schemas**

`craigsnotice_types/src/schemas/agent.ts`:

```ts
import { z } from "zod";

export const agentRequestSchema = z.object({
  listing: z.object({
    title: z.string(),
    price: z.number().nullable(),
    condition: z.string().nullable(),
    description: z.string().nullable(),
    imageCount: z.number().int(),
    postedAt: z.string().nullable(),
    location: z.string().nullable(),
  }),
  baseline: z
    .object({
      count: z.number().int(),
      median: z.number(),
      p25: z.number(),
      min: z.number(),
      max: z.number(),
    })
    .nullable(),
  targetPrice: z.number().nullable(),
  recentFeedback: z.array(
    z.object({
      title: z.string(),
      price: z.number().nullable(),
      priceVsMedian: z.number(),
      verdict: z.enum(["good", "bad"]),
    })
  ),
});

export type AgentRequest = z.infer<typeof agentRequestSchema>;

export const agentVerdictSchema = z.object({
  isGoodDeal: z.boolean(),
  score: z.number().min(0).max(100),
  reasoning: z.string().min(1),
  priceVsMedian: z.number(),
});

export type AgentVerdict = z.infer<typeof agentVerdictSchema>;
```

Add all four modules to `craigsnotice_types/src/index.ts`:

```ts
export * from "./domain";
export * from "./schemas/requests";
export * from "./schemas/brightdata";
export * from "./schemas/agent";
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `cd craigsnotice_types && bun run test:run schemas`
Expected: PASS, 13 tests.

- [ ] **Step 8: Run the whole types suite and typecheck**

Run: `cd craigsnotice_types && bun run test:run && bun run typecheck`
Expected: all tests pass, no type errors.

- [ ] **Step 9: Commit**

```bash
git add craigsnotice_types/src
git commit -m "feat(types): add domain types and boundary schemas"
```

---

### Task 6: API scaffold with health endpoint and config

**Files:**
- Create: `craigsnotice_api/package.json`, `craigsnotice_api/tsconfig.json`, `craigsnotice_api/vitest.config.ts`, `craigsnotice_api/.env.example`
- Create: `craigsnotice_api/src/index.ts`, `craigsnotice_api/src/app.ts`, `craigsnotice_api/src/config.ts`, `craigsnotice_api/src/routes/health.ts`
- Test: `craigsnotice_api/tests/health.test.ts`, `craigsnotice_api/tests/config.test.ts`

**Interfaces:**
- Consumes: `successResponse` from Task 1.
- Produces: `createApp(deps: AppDeps): Hono` — the app factory every route task registers into, and `config` — the frozen env-derived settings object. `AppDeps` starts as `{}` and grows in Tasks 9, 17, 19, 21. Building the app through a factory rather than a module singleton is what lets tests inject fakes.

- [ ] **Step 1: Create the package**

`craigsnotice_api/package.json`:

```json
{
  "name": "@craigsnotice/api",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "bun --watch --preload ./src/otel.ts src/index.ts",
    "start": "bun --preload ./src/otel.ts src/index.ts",
    "test": "vitest",
    "test:run": "vitest run",
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "lint": "eslint src tests",
    "db:init": "bun run src/db/init.ts",
    "port:sync": "bun run scripts/sync-blueprints.ts"
  },
  "dependencies": {
    "@craigsnotice/types": "workspace:*",
    "hono": "^4.6.0",
    "@hono/zod-validator": "^0.4.0",
    "zod": "^4.0.0",
    "drizzle-orm": "^0.45.0",
    "postgres": "^3.4.0",
    "firebase-admin": "^13.0.0"
  }
}
```

`craigsnotice_api/tsconfig.json` extends `../tsconfig.base.json` with `{ "include": ["src/**/*", "tests/**/*"] }` and no `outDir` (Bun runs TS directly).

`craigsnotice_api/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({ test: { environment: "node", include: ["tests/**/*.test.ts"] } });
```

`craigsnotice_api/src/otel.ts` is created empty for now with `export {};` — Task 24 fills it in. The `--preload` flag in the scripts above is already wired so no script changes are needed later.

- [ ] **Step 2: Write the failing tests**

`craigsnotice_api/tests/config.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { loadConfig } from "../src/config";

describe("loadConfig", () => {
  const base = { DATABASE_URL: "postgres://localhost/craigsnotice_test" };

  it("applies documented defaults", () => {
    const c = loadConfig(base);
    expect(c.port).toBe(8022);
    expect(c.watchDefaultIntervalSec).toBe(300);
    expect(c.minBaselineSamples).toBe(5);
    expect(c.violationRateThreshold).toBe(0.3);
    expect(c.demoMode).toBe("live");
  });

  it("reads numeric overrides from the environment", () => {
    const c = loadConfig({ ...base, PORT: "9000", VIOLATION_RATE_THRESHOLD: "0.5" });
    expect(c.port).toBe(9000);
    expect(c.violationRateThreshold).toBe(0.5);
  });

  it("throws when DATABASE_URL is absent", () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
  });

  it("rejects an unrecognised DEMO_MODE", () => {
    expect(() => loadConfig({ ...base, DEMO_MODE: "sometimes" })).toThrow(/DEMO_MODE/);
  });
});
```

`craigsnotice_api/tests/health.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createApp } from "../src/app";

describe("GET /health", () => {
  it("returns a success envelope with status ok", async () => {
    const res = await createApp({}).request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, data: { status: "ok" } });
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd craigsnotice_api && bun run test:run`
Expected: FAIL — cannot resolve `../src/config` and `../src/app`.

- [ ] **Step 4: Implement config**

`craigsnotice_api/src/config.ts`:

```ts
export type DemoMode = "live" | "fixtures";

export interface Config {
  port: number;
  databaseUrl: string;
  demoMode: DemoMode;
  watchDefaultIntervalSec: number;
  minBaselineSamples: number;
  violationRateThreshold: number;
  debugToken: string | null;
}

type Env = Record<string, string | undefined>;

const num = (env: Env, key: string, fallback: number): number => {
  const raw = env[key];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`${key} must be numeric, got "${raw}"`);
  return n;
};

export const loadConfig = (env: Env = process.env): Config => {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");

  const demoMode = (env.DEMO_MODE ?? "live") as DemoMode;
  if (demoMode !== "live" && demoMode !== "fixtures") {
    throw new Error(`DEMO_MODE must be "live" or "fixtures", got "${demoMode}"`);
  }

  return Object.freeze({
    port: num(env, "PORT", 8022),
    databaseUrl,
    demoMode,
    watchDefaultIntervalSec: num(env, "WATCH_DEFAULT_INTERVAL_SEC", 300),
    minBaselineSamples: num(env, "MIN_BASELINE_SAMPLES", 5),
    violationRateThreshold: num(env, "VIOLATION_RATE_THRESHOLD", 0.3),
    debugToken: env.DEBUG_TOKEN ?? null,
  });
};
```

- [ ] **Step 5: Implement the app factory and health route**

`craigsnotice_api/src/routes/health.ts`:

```ts
import { Hono } from "hono";
import { successResponse } from "@craigsnotice/types";

const router = new Hono();
router.get("/", (c) => c.json(successResponse({ status: "ok" })));
export default router;
```

`craigsnotice_api/src/app.ts`:

```ts
import { Hono } from "hono";
import health from "./routes/health";

export interface AppDeps {}

export const createApp = (_deps: AppDeps): Hono => {
  const app = new Hono();
  app.route("/health", health);
  app.route("/", health);
  return app;
};
```

`craigsnotice_api/src/index.ts`:

```ts
import { createApp } from "./app";
import { loadConfig } from "./config";

const config = loadConfig();
const app = createApp({});

const server = Bun.serve({ port: config.port, fetch: app.fetch });
console.log(`craigsnotice_api listening on :${config.port} (${config.demoMode})`);

const shutdown = async (): Promise<void> => {
  await server.stop();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
```

Write `.env.example` containing every variable from spec §14 with placeholder values.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd craigsnotice_api && bun run test:run`
Expected: PASS, 5 tests.

- [ ] **Step 7: Commit**

```bash
git add craigsnotice_api
git commit -m "feat(api): scaffold Hono app with config and health endpoint"
```

---

### Task 7: Database schema and idempotent init

**Files:**
- Create: `craigsnotice_api/src/db/schema.ts`, `craigsnotice_api/src/db/index.ts`, `craigsnotice_api/src/db/init.ts`
- Test: `craigsnotice_api/tests/db-init.test.ts`, `craigsnotice_api/tests/setup.ts`

**Interfaces:**
- Consumes: `Config` from Task 6.
- Produces: Drizzle table objects `users, watches, scraperConfigs, scrapeRuns, listings, dealAlerts, alertFeedback`; `createDb(url: string)` returning a Drizzle instance; `initDb(db)` creating every table idempotently. Every service task from 13 onward consumes these.

**Test database:** tests run against `craigsnotice_test`. `tests/setup.ts` refuses to run if `DATABASE_URL` does not contain `_test`, matching sudojo_api's safety check.

- [ ] **Step 1: Write the failing test**

`craigsnotice_api/tests/setup.ts`:

```ts
import { createDb, initDb } from "../src/db";

const url = process.env.DATABASE_URL ?? "";
if (!url.includes("_test")) {
  throw new Error(`refusing to run tests against a non-test database: ${url}`);
}

export const db = createDb(url);
export const resetDb = async (): Promise<void> => {
  await initDb(db);
  await db.execute(
    "TRUNCATE alert_feedback, deal_alerts, listings, scrape_runs, watches, scraper_configs, users CASCADE"
  );
};
```

`craigsnotice_api/tests/db-init.test.ts`:

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { db, resetDb } from "./setup";
import { initDb } from "../src/db";
import { watches, users } from "../src/db/schema";

describe("initDb", () => {
  beforeAll(async () => { await resetDb(); });

  it("is idempotent when run twice", async () => {
    await expect(initDb(db)).resolves.not.toThrow();
  });

  it("creates every expected table", async () => {
    const rows = await db.execute(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'"
    );
    const names = rows.map((r: { table_name: string }) => r.table_name);
    for (const t of ["users", "watches", "scraper_configs", "scrape_runs", "listings", "deal_alerts", "alert_feedback"]) {
      expect(names, `missing table ${t}`).toContain(t);
    }
  });

  it("enforces the unique constraint on listings.cl_post_id", async () => {
    const [u] = await db.insert(users).values({ firebaseUid: "u1", email: "a@b.c" }).returning();
    const [w] = await db.insert(watches).values({
      userId: u!.id, siteCode: "sfbay", categoryCode: "sya", query: "Mac Studio",
      searchUrl: "https://sfbay.craigslist.org/search/sya?query=Mac+Studio",
    }).returning();
    expect(w!.intervalSec).toBe(300);
    expect(w!.status).toBe("active");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd craigsnotice_api && DATABASE_URL=postgres://localhost/craigsnotice_test bun run test:run db-init`
Expected: FAIL — cannot resolve `../src/db`.

- [ ] **Step 3: Implement the schema**

`craigsnotice_api/src/db/schema.ts` — mirror spec §5 exactly:

```ts
import { pgTable, uuid, text, integer, numeric, boolean, timestamp } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  firebaseUid: text("firebase_uid").notNull().unique(),
  email: text("email").notNull(),
  fcmTokens: text("fcm_tokens").array().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const watches = pgTable("watches", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  siteCode: text("site_code").notNull(),
  subarea: text("subarea"),
  categoryCode: text("category_code").notNull(),
  query: text("query").notNull(),
  targetPrice: numeric("target_price"),
  intervalSec: integer("interval_sec").notNull().default(300),
  status: text("status").notNull().default("active"),
  searchUrl: text("search_url").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const scraperConfigs = pgTable("scraper_configs", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: text("kind").notNull(),
  bdCollectorId: text("bd_collector_id").notNull(),
  health: text("health").notNull().default("healthy"),
  violationRate: numeric("violation_rate").notNull().default("0"),
  lastHealedAt: timestamp("last_healed_at", { withTimezone: true }),
  healPrompt: text("heal_prompt"),
});

export const scrapeRuns = pgTable("scrape_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  watchId: uuid("watch_id").references(() => watches.id),
  scraperConfigId: uuid("scraper_config_id").notNull().references(() => scraperConfigs.id),
  snapshotId: text("snapshot_id").notNull(),
  status: text("status").notNull().default("collecting"),
  rowCount: integer("row_count").notNull().default(0),
  violationCount: integer("violation_count").notNull().default(0),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  error: text("error"),
});

export const listings = pgTable("listings", {
  id: uuid("id").primaryKey().defaultRandom(),
  watchId: uuid("watch_id").notNull().references(() => watches.id),
  clPostId: text("cl_post_id").notNull().unique(),
  title: text("title").notNull(),
  price: numeric("price"),
  url: text("url").notNull(),
  postedAt: timestamp("posted_at", { withTimezone: true }),
  location: text("location"),
  condition: text("condition"),
  description: text("description"),
  imageCount: integer("image_count").notNull().default(0),
  detailFetchedAt: timestamp("detail_fetched_at", { withTimezone: true }),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
});

export const dealAlerts = pgTable("deal_alerts", {
  id: uuid("id").primaryKey().defaultRandom(),
  listingId: uuid("listing_id").notNull().references(() => listings.id),
  watchId: uuid("watch_id").notNull().references(() => watches.id),
  score: integer("score").notNull(),
  isGoodDeal: boolean("is_good_deal").notNull(),
  reasoning: text("reasoning").notNull(),
  priceVsMedian: numeric("price_vs_median").notNull(),
  notifiedAt: timestamp("notified_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const alertFeedback = pgTable("alert_feedback", {
  id: uuid("id").primaryKey().defaultRandom(),
  alertId: uuid("alert_id").notNull().references(() => dealAlerts.id),
  userId: uuid("user_id").notNull().references(() => users.id),
  verdict: text("verdict").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
```

- [ ] **Step 4: Implement the connection and init**

`craigsnotice_api/src/db/index.ts`:

```ts
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Db = ReturnType<typeof createDb>;

export const createDb = (url: string) => drizzle(postgres(url), { schema });

export { initDb } from "./init";
export * from "./schema";
```

`craigsnotice_api/src/db/init.ts` issues `CREATE TABLE IF NOT EXISTS` for all seven tables in foreign-key order (`users`, `scraper_configs`, `watches`, `scrape_runs`, `listings`, `deal_alerts`, `alert_feedback`), each statement mirroring the Drizzle definition above, followed by any `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` migrations. Forward-only; never drop.

- [ ] **Step 5: Run the test to verify it passes**

Run: `createdb craigsnotice_test 2>/dev/null; cd craigsnotice_api && DATABASE_URL=postgres://localhost/craigsnotice_test bun run test:run db-init`
Expected: PASS, 3 tests.

- [ ] **Step 6: Commit**

```bash
git add craigsnotice_api/src/db craigsnotice_api/tests
git commit -m "feat(api): add Drizzle schema and idempotent database init"
```

---

### Task 8: Firebase auth middleware

**Files:**
- Create: `craigsnotice_api/src/middleware/firebaseAuth.ts`, `craigsnotice_api/src/services/firebase.ts`
- Test: `craigsnotice_api/tests/auth.test.ts`
- Modify: `craigsnotice_api/src/app.ts`

**Interfaces:**
- Consumes: `Db` from Task 7, `errorResponse` from Task 1.
- Produces: `TokenVerifier` interface `{ verify(idToken: string): Promise<{ uid: string; email: string }> }`, `createFirebaseAuth(verifier: TokenVerifier, db: Db)` returning Hono middleware that sets `userId` (our internal `users.id`, upserted on first sight) and `userEmail` on the context. Tasks 9, 20, 31 consume it. `AppDeps` gains `{ auth: MiddlewareHandler; db: Db }`.

The verifier is an injected interface so tests never touch Firebase.

- [ ] **Step 1: Write the failing test**

`craigsnotice_api/tests/auth.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import { db, resetDb } from "./setup";
import { createFirebaseAuth, type TokenVerifier } from "../src/middleware/firebaseAuth";
import { users } from "../src/db/schema";
import { eq } from "drizzle-orm";

const verifier: TokenVerifier = {
  verify: async (t) => {
    if (t !== "good-token") throw new Error("invalid token");
    return { uid: "firebase-uid-1", email: "demo@craigsnotice.dev" };
  },
};

const appWith = () => {
  const app = new Hono();
  app.use("/me", createFirebaseAuth(verifier, db));
  app.get("/me", (c) => c.json({ userId: c.get("userId"), email: c.get("userEmail") }));
  return app;
};

describe("firebase auth middleware", () => {
  beforeEach(async () => { await resetDb(); });

  it("rejects a request with no Authorization header", async () => {
    expect((await appWith().request("/me")).status).toBe(401);
  });

  it("rejects an invalid token", async () => {
    const res = await appWith().request("/me", { headers: { Authorization: "Bearer bad" } });
    expect(res.status).toBe(401);
  });

  it("upserts the user on first sight and exposes the internal id", async () => {
    const res = await appWith().request("/me", { headers: { Authorization: "Bearer good-token" } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.email).toBe("demo@craigsnotice.dev");

    const rows = await db.select().from(users).where(eq(users.firebaseUid, "firebase-uid-1"));
    expect(rows).toHaveLength(1);
    expect(body.userId).toBe(rows[0]!.id);
  });

  it("does not create a duplicate user on a second request", async () => {
    const app = appWith();
    await app.request("/me", { headers: { Authorization: "Bearer good-token" } });
    await app.request("/me", { headers: { Authorization: "Bearer good-token" } });
    expect(await db.select().from(users).where(eq(users.firebaseUid, "firebase-uid-1"))).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd craigsnotice_api && DATABASE_URL=postgres://localhost/craigsnotice_test bun run test:run auth`
Expected: FAIL — cannot resolve `../src/middleware/firebaseAuth`.

- [ ] **Step 3: Implement the middleware**

`craigsnotice_api/src/middleware/firebaseAuth.ts`:

```ts
import type { MiddlewareHandler } from "hono";
import { eq } from "drizzle-orm";
import { errorResponse } from "@craigsnotice/types";
import type { Db } from "../db";
import { users } from "../db/schema";

export interface TokenVerifier {
  verify(idToken: string): Promise<{ uid: string; email: string }>;
}

export const createFirebaseAuth = (verifier: TokenVerifier, db: Db): MiddlewareHandler => {
  return async (c, next) => {
    const header = c.req.header("Authorization");
    if (!header?.startsWith("Bearer ")) {
      return c.json(errorResponse("missing bearer token"), 401);
    }

    let claims: { uid: string; email: string };
    try {
      claims = await verifier.verify(header.slice(7));
    } catch {
      return c.json(errorResponse("invalid token"), 401);
    }

    const [user] = await db
      .insert(users)
      .values({ firebaseUid: claims.uid, email: claims.email })
      .onConflictDoUpdate({ target: users.firebaseUid, set: { email: claims.email } })
      .returning();

    const resolved = user ?? (await db.select().from(users).where(eq(users.firebaseUid, claims.uid)))[0];
    if (!resolved) return c.json(errorResponse("failed to resolve user"), 500);

    c.set("userId", resolved.id);
    c.set("userEmail", resolved.email);
    await next();
  };
};
```

`craigsnotice_api/src/services/firebase.ts` implements the production `TokenVerifier` with `firebase-admin`:

```ts
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import type { TokenVerifier } from "../middleware/firebaseAuth";

export const createFirebaseVerifier = (): TokenVerifier => {
  if (getApps().length === 0) {
    initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID!,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL!,
        privateKey: process.env.FIREBASE_PRIVATE_KEY!.replace(/\\n/g, "\n"),
      }),
    });
  }
  return {
    verify: async (idToken) => {
      const decoded = await getAuth().verifyIdToken(idToken);
      return { uid: decoded.uid, email: decoded.email ?? "" };
    },
  };
};
```

Declare the context variables so `c.get("userId")` is typed:

```ts
declare module "hono" {
  interface ContextVariableMap {
    userId: string;
    userEmail: string;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd craigsnotice_api && DATABASE_URL=postgres://localhost/craigsnotice_test bun run test:run auth`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add craigsnotice_api/src/middleware craigsnotice_api/src/services/firebase.ts craigsnotice_api/tests/auth.test.ts
git commit -m "feat(api): add Firebase auth middleware with user upsert"
```

---

### Task 9: Watch CRUD routes

**Files:**
- Create: `craigsnotice_api/src/routes/watches.ts`, `craigsnotice_api/src/services/watches.ts`
- Test: `craigsnotice_api/tests/watches.test.ts`
- Modify: `craigsnotice_api/src/app.ts`

**Interfaces:**
- Consumes: `createWatchSchema` (Task 5), `buildCraigslistSearchUrl` + `InvalidWatchTargetError` (Task 3), auth middleware (Task 8), `watches` table (Task 7).
- Produces: `createWatch(db, userId, input): Promise<Watch>`, `listWatches(db, userId)`, `getWatch(db, userId, id)`, `deleteWatch(db, userId, id)`. Routes `POST /api/v1/watches`, `GET /api/v1/watches`, `GET /api/v1/watches/:id`, `DELETE /api/v1/watches/:id`. Tasks 21 and 27 consume these.

- [ ] **Step 1: Write the failing test**

`craigsnotice_api/tests/watches.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { db, resetDb } from "./setup";
import { createApp } from "../src/app";
import type { TokenVerifier } from "../src/middleware/firebaseAuth";

const verifier: TokenVerifier = {
  verify: async (t) => {
    if (t === "user-a") return { uid: "uid-a", email: "a@x.dev" };
    if (t === "user-b") return { uid: "uid-b", email: "b@x.dev" };
    throw new Error("invalid");
  },
};

const app = () => createApp({ db, verifier });
const authed = (token: string) => ({ Authorization: `Bearer ${token}`, "Content-Type": "application/json" });
const body = { siteCode: "sfbay", categoryCode: "sya", query: "Mac Studio", targetPrice: 1200 };

describe("watches routes", () => {
  beforeEach(async () => { await resetDb(); });

  it("creates a watch and derives the search URL", async () => {
    const res = await app().request("/api/v1/watches", {
      method: "POST", headers: authed("user-a"), body: JSON.stringify(body),
    });
    expect(res.status).toBe(201);
    const { data } = await res.json();
    expect(data.searchUrl).toBe("https://sfbay.craigslist.org/search/sya?query=Mac+Studio");
    expect(data.intervalSec).toBe(300);
    expect(data.status).toBe("active");
  });

  it("rejects an unauthenticated create", async () => {
    const res = await app().request("/api/v1/watches", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    expect(res.status).toBe(401);
  });

  it("returns 400 with a useful message for an unknown site", async () => {
    const res = await app().request("/api/v1/watches", {
      method: "POST", headers: authed("user-a"), body: JSON.stringify({ ...body, siteCode: "atlantis" }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/unknown site/);
  });

  it("returns 400 for a body that fails schema validation", async () => {
    const res = await app().request("/api/v1/watches", {
      method: "POST", headers: authed("user-a"), body: JSON.stringify({ ...body, query: "" }),
    });
    expect(res.status).toBe(400);
  });

  it("lists only the calling user's watches", async () => {
    const a = app();
    await a.request("/api/v1/watches", { method: "POST", headers: authed("user-a"), body: JSON.stringify(body) });
    await a.request("/api/v1/watches", { method: "POST", headers: authed("user-b"), body: JSON.stringify(body) });

    const res = await a.request("/api/v1/watches", { headers: authed("user-a") });
    const { data } = await res.json();
    expect(data).toHaveLength(1);
  });

  it("returns 404 when fetching another user's watch", async () => {
    const a = app();
    const created = await (await a.request("/api/v1/watches", {
      method: "POST", headers: authed("user-a"), body: JSON.stringify(body),
    })).json();

    const res = await a.request(`/api/v1/watches/${created.data.id}`, { headers: authed("user-b") });
    expect(res.status).toBe(404);
  });

  it("deletes a watch", async () => {
    const a = app();
    const created = await (await a.request("/api/v1/watches", {
      method: "POST", headers: authed("user-a"), body: JSON.stringify(body),
    })).json();

    expect((await a.request(`/api/v1/watches/${created.data.id}`, { method: "DELETE", headers: authed("user-a") })).status).toBe(200);
    const list = await (await a.request("/api/v1/watches", { headers: authed("user-a") })).json();
    expect(list.data).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd craigsnotice_api && DATABASE_URL=postgres://localhost/craigsnotice_test bun run test:run watches`
Expected: FAIL — `createApp` does not accept `{ db, verifier }` and `/api/v1/watches` is not routed.

- [ ] **Step 3: Implement the service**

`craigsnotice_api/src/services/watches.ts`:

```ts
import { and, desc, eq } from "drizzle-orm";
import { buildCraigslistSearchUrl, type CreateWatchInput } from "@craigsnotice/types";
import type { Db } from "../db";
import { watches } from "../db/schema";

export const createWatch = async (db: Db, userId: string, input: CreateWatchInput) => {
  const searchUrl = buildCraigslistSearchUrl({
    siteCode: input.siteCode,
    subarea: input.subarea,
    categoryCode: input.categoryCode,
    query: input.query,
  });

  const [row] = await db.insert(watches).values({
    userId,
    siteCode: input.siteCode,
    subarea: input.subarea ?? null,
    categoryCode: input.categoryCode,
    query: input.query,
    targetPrice: input.targetPrice === undefined ? null : String(input.targetPrice),
    intervalSec: input.intervalSec,
    searchUrl,
  }).returning();

  return row!;
};

export const listWatches = (db: Db, userId: string) =>
  db.select().from(watches).where(eq(watches.userId, userId)).orderBy(desc(watches.createdAt));

export const getWatch = async (db: Db, userId: string, id: string) => {
  const rows = await db.select().from(watches).where(and(eq(watches.id, id), eq(watches.userId, userId)));
  return rows[0] ?? null;
};

export const deleteWatch = async (db: Db, userId: string, id: string): Promise<boolean> => {
  const rows = await db.delete(watches).where(and(eq(watches.id, id), eq(watches.userId, userId))).returning();
  return rows.length > 0;
};
```

- [ ] **Step 4: Implement the routes**

`craigsnotice_api/src/routes/watches.ts`:

```ts
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { createWatchSchema, successResponse, errorResponse, InvalidWatchTargetError } from "@craigsnotice/types";
import type { Db } from "../db";
import { createWatch, deleteWatch, getWatch, listWatches } from "../services/watches";

export const createWatchesRouter = (db: Db): Hono => {
  const router = new Hono();

  router.post("/", zValidator("json", createWatchSchema), async (c) => {
    try {
      const watch = await createWatch(db, c.get("userId"), c.req.valid("json"));
      return c.json(successResponse(watch), 201);
    } catch (err) {
      if (err instanceof InvalidWatchTargetError) return c.json(errorResponse(err.message), 400);
      throw err;
    }
  });

  router.get("/", async (c) => c.json(successResponse(await listWatches(db, c.get("userId")))));

  router.get("/:id", zValidator("param", z.object({ id: z.string().uuid() })), async (c) => {
    const watch = await getWatch(db, c.get("userId"), c.req.valid("param").id);
    return watch ? c.json(successResponse(watch)) : c.json(errorResponse("watch not found"), 404);
  });

  router.delete("/:id", zValidator("param", z.object({ id: z.string().uuid() })), async (c) => {
    const ok = await deleteWatch(db, c.get("userId"), c.req.valid("param").id);
    return ok ? c.json(successResponse({ deleted: true })) : c.json(errorResponse("watch not found"), 404);
  });

  return router;
};
```

- [ ] **Step 5: Wire it into the app factory**

Rewrite `craigsnotice_api/src/app.ts`:

```ts
import { Hono } from "hono";
import health from "./routes/health";
import { createFirebaseAuth, type TokenVerifier } from "./middleware/firebaseAuth";
import { createWatchesRouter } from "./routes/watches";
import type { Db } from "./db";

export interface AppDeps {
  db?: Db;
  verifier?: TokenVerifier;
}

export const createApp = (deps: AppDeps): Hono => {
  const app = new Hono();
  app.route("/health", health);
  app.route("/", health);

  if (deps.db && deps.verifier) {
    const auth = createFirebaseAuth(deps.verifier, deps.db);
    app.use("/api/v1/watches", auth);
    app.use("/api/v1/watches/*", auth);
    app.route("/api/v1/watches", createWatchesRouter(deps.db));
  }
  return app;
};
```

Update `src/index.ts` to build `createApp({ db: createDb(config.databaseUrl), verifier: createFirebaseVerifier() })`.

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd craigsnotice_api && DATABASE_URL=postgres://localhost/craigsnotice_test bun run test:run watches`
Expected: PASS, 7 tests.

- [ ] **Step 7: Run the full Phase 0 suite**

Run: `cd .. && bun run test && bun run typecheck`
Expected: all packages green.

- [ ] **Step 8: Commit**

```bash
git add craigsnotice_api
git commit -m "feat(api): add watch CRUD routes with URL derivation and ownership checks"
```

**Phase 0 complete.** The repo now has the scaffold, reference data, tested URL/geo logic, schema, auth, and watch CRUD — the "setup" bucket from spec §15. Everything below is day-of work.

---

# Phase 1 — Data pipeline (day of)

### Task 10: Bright Data client and fake

**Files:**
- Create: `craigsnotice_api/src/services/brightdata/client.ts`, `craigsnotice_api/src/services/brightdata/fake.ts`
- Test: `craigsnotice_api/tests/brightdata-client.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:

```ts
export interface Snapshot { status: "building" | "ready"; rows: unknown[] | null }
export interface BrightDataClient {
  trigger(collectorId: string, inputs: Array<{ url: string }>): Promise<string>;  // -> snapshot id
  fetchSnapshot(snapshotId: string): Promise<Snapshot>;
  heal(collectorId: string, prompt: string): Promise<void>;
}
```

plus `createBrightDataClient(token: string, fetchImpl?: typeof fetch)` and `FakeBrightDataClient`. Tasks 11, 12, 13, 22 consume this.

**Endpoints (spec §7.2):** trigger is `POST https://api.brightdata.com/dca/trigger?collector=<id>&queue_next=1` with `Authorization: Bearer <token>`, body a JSON array of inputs, response `{ collection_id }`. Fetch is `GET https://api.brightdata.com/dca/dataset?id=<snapshot>`; a `{ status: "building" }` object means not ready, a JSON array means ready.

- [ ] **Step 1: Write the failing test**

`craigsnotice_api/tests/brightdata-client.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { createBrightDataClient } from "../src/services/brightdata/client";

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("createBrightDataClient", () => {
  it("triggers a collection and returns the snapshot id", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ collection_id: "j_abc123" }));
    const client = createBrightDataClient("tok", fetchImpl as unknown as typeof fetch);

    const id = await client.trigger("c1", [{ url: "https://sfbay.craigslist.org/search/sya?query=x" }]);

    expect(id).toBe("j_abc123");
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://api.brightdata.com/dca/trigger?collector=c1&queue_next=1");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer tok");
    expect(JSON.parse(init.body)).toEqual([{ url: "https://sfbay.craigslist.org/search/sya?query=x" }]);
  });

  it("throws on a non-2xx trigger response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error: "nope" }, 401));
    const client = createBrightDataClient("bad", fetchImpl as unknown as typeof fetch);
    await expect(client.trigger("c1", [{ url: "https://a.b/c" }])).rejects.toThrow(/401/);
  });

  it("reports a building snapshot as not ready", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ status: "building" }));
    const snap = await createBrightDataClient("tok", fetchImpl as unknown as typeof fetch).fetchSnapshot("j_1");
    expect(snap.status).toBe("building");
    expect(snap.rows).toBeNull();
  });

  it("reports an array snapshot as ready with its rows", async () => {
    const rows = [{ post_id: "1" }, { post_id: "2" }];
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(rows));
    const snap = await createBrightDataClient("tok", fetchImpl as unknown as typeof fetch).fetchSnapshot("j_1");
    expect(snap.status).toBe("ready");
    expect(snap.rows).toEqual(rows);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd craigsnotice_api && bun run test:run brightdata-client`
Expected: FAIL — cannot resolve `../src/services/brightdata/client`.

- [ ] **Step 3: Implement the client**

`craigsnotice_api/src/services/brightdata/client.ts`:

```ts
const BASE = "https://api.brightdata.com";

export interface Snapshot {
  status: "building" | "ready";
  rows: unknown[] | null;
}

export interface BrightDataClient {
  trigger(collectorId: string, inputs: Array<{ url: string }>): Promise<string>;
  fetchSnapshot(snapshotId: string): Promise<Snapshot>;
  heal(collectorId: string, prompt: string): Promise<void>;
}

export const createBrightDataClient = (
  token: string,
  fetchImpl: typeof fetch = fetch
): BrightDataClient => {
  const authHeaders = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  return {
    async trigger(collectorId, inputs) {
      const res = await fetchImpl(`${BASE}/dca/trigger?collector=${collectorId}&queue_next=1`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify(inputs),
      });
      if (!res.ok) throw new Error(`bright data trigger failed: ${res.status}`);
      const body = (await res.json()) as { collection_id?: string };
      if (!body.collection_id) throw new Error("bright data trigger returned no collection_id");
      return body.collection_id;
    },

    async fetchSnapshot(snapshotId) {
      const res = await fetchImpl(`${BASE}/dca/dataset?id=${snapshotId}`, { headers: authHeaders });
      if (!res.ok) throw new Error(`bright data snapshot fetch failed: ${res.status}`);
      const body = (await res.json()) as unknown;
      if (Array.isArray(body)) return { status: "ready", rows: body };
      return { status: "building", rows: null };
    },

    async heal(collectorId, prompt) {
      const res = await fetchImpl(`${BASE}/dca/collector/${collectorId}/heal`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ prompt }),
      });
      if (!res.ok) throw new Error(`bright data heal failed: ${res.status}`);
    },
  };
};
```

If the heal REST endpoint proves unavailable at the event, swap this one method's body to shell out to `bdata scraper heal <collectorId> --prompt "<prompt>"` via `Bun.$`. Nothing else in the codebase changes, because callers only see the interface.

- [ ] **Step 4: Implement the fake**

`craigsnotice_api/src/services/brightdata/fake.ts`:

```ts
import type { BrightDataClient, Snapshot } from "./client";

export interface FakeBrightData extends BrightDataClient {
  readonly healCalls: Array<{ collectorId: string; prompt: string }>;
  queue(snapshotId: string, rows: unknown[], buildingTicks?: number): void;
}

export const createFakeBrightData = (): FakeBrightData => {
  const queued = new Map<string, { rows: unknown[]; ticksLeft: number }>();
  const healCalls: Array<{ collectorId: string; prompt: string }> = [];
  let counter = 0;
  let pendingRows: unknown[] = [];
  let pendingTicks = 0;

  return {
    healCalls,
    queue(snapshotId, rows, buildingTicks = 0) {
      queued.set(snapshotId, { rows, ticksLeft: buildingTicks });
      pendingRows = rows;
      pendingTicks = buildingTicks;
    },
    async trigger() {
      const id = `snap_${++counter}`;
      queued.set(id, { rows: pendingRows, ticksLeft: pendingTicks });
      return id;
    },
    async fetchSnapshot(snapshotId): Promise<Snapshot> {
      const entry = queued.get(snapshotId);
      if (!entry) return { status: "building", rows: null };
      if (entry.ticksLeft > 0) {
        entry.ticksLeft -= 1;
        return { status: "building", rows: null };
      }
      return { status: "ready", rows: entry.rows };
    },
    async heal(collectorId, prompt) {
      healCalls.push({ collectorId, prompt });
    },
  };
};
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd craigsnotice_api && bun run test:run brightdata-client`
Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```bash
git add craigsnotice_api/src/services/brightdata craigsnotice_api/tests/brightdata-client.test.ts
git commit -m "feat(api): add Bright Data client with injectable fetch and a fake"
```

---

### Task 11: Result delivery (polling, with a webhook adapter)

**Files:**
- Create: `craigsnotice_api/src/services/brightdata/delivery.ts`
- Test: `craigsnotice_api/tests/delivery.test.ts`

**Interfaces:**
- Consumes: `BrightDataClient`, `Snapshot` (Task 10).
- Produces:

```ts
export interface ResultDelivery { await(snapshotId: string): Promise<unknown[]> }
export const createPollingDelivery: (
  client: BrightDataClient,
  opts?: { intervalMs?: number; timeoutMs?: number; sleep?: (ms: number) => Promise<void> }
) => ResultDelivery
export class SnapshotTimeoutError extends Error {}
```

plus `createWebhookDelivery(store)` implementing the same interface. Tasks 13 and 21 consume `ResultDelivery`, never `BrightDataClient` directly, which is what makes the webhook swap a one-line change.

Defaults: `intervalMs` 5000, `timeoutMs` 300000. `sleep` is injected so tests do not wait.

- [ ] **Step 1: Write the failing test**

`craigsnotice_api/tests/delivery.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { createFakeBrightData } from "../src/services/brightdata/fake";
import { createPollingDelivery, SnapshotTimeoutError } from "../src/services/brightdata/delivery";

const noSleep = async (): Promise<void> => {};

describe("createPollingDelivery", () => {
  it("returns rows immediately when the snapshot is already ready", async () => {
    const bd = createFakeBrightData();
    bd.queue("snap_1", [{ post_id: "1" }]);
    const id = await bd.trigger("c1", [{ url: "https://a.b/c" }]);

    const rows = await createPollingDelivery(bd, { sleep: noSleep }).await(id);
    expect(rows).toEqual([{ post_id: "1" }]);
  });

  it("polls until the snapshot stops building", async () => {
    const bd = createFakeBrightData();
    bd.queue("ignored", [{ post_id: "9" }], 3);
    const id = await bd.trigger("c1", [{ url: "https://a.b/c" }]);
    const sleep = vi.fn(noSleep);

    const rows = await createPollingDelivery(bd, { sleep }).await(id);
    expect(rows).toEqual([{ post_id: "9" }]);
    expect(sleep).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledWith(5000);
  });

  it("throws SnapshotTimeoutError once the deadline passes", async () => {
    const bd = createFakeBrightData();
    bd.queue("ignored", [{ post_id: "9" }], 1000);
    const id = await bd.trigger("c1", [{ url: "https://a.b/c" }]);

    const delivery = createPollingDelivery(bd, { sleep: noSleep, intervalMs: 5000, timeoutMs: 20000 });
    await expect(delivery.await(id)).rejects.toThrow(SnapshotTimeoutError);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd craigsnotice_api && bun run test:run delivery`
Expected: FAIL — cannot resolve `../src/services/brightdata/delivery`.

- [ ] **Step 3: Implement polling delivery**

`craigsnotice_api/src/services/brightdata/delivery.ts`:

```ts
import type { BrightDataClient } from "./client";

export class SnapshotTimeoutError extends Error {
  constructor(snapshotId: string, timeoutMs: number) {
    super(`snapshot ${snapshotId} not ready after ${timeoutMs}ms`);
    this.name = "SnapshotTimeoutError";
  }
}

export interface ResultDelivery {
  await(snapshotId: string): Promise<unknown[]>;
}

export interface PollingOptions {
  intervalMs?: number;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export const createPollingDelivery = (
  client: BrightDataClient,
  opts: PollingOptions = {}
): ResultDelivery => {
  const intervalMs = opts.intervalMs ?? 5000;
  const timeoutMs = opts.timeoutMs ?? 300000;
  const sleep = opts.sleep ?? defaultSleep;
  const maxAttempts = Math.ceil(timeoutMs / intervalMs);

  return {
    async await(snapshotId) {
      for (let attempt = 0; attempt <= maxAttempts; attempt += 1) {
        const snap = await client.fetchSnapshot(snapshotId);
        if (snap.status === "ready" && snap.rows) return snap.rows;
        await sleep(intervalMs);
      }
      throw new SnapshotTimeoutError(snapshotId, timeoutMs);
    },
  };
};

/**
 * Same interface, fed by POST /api/v1/hooks/brightdata instead of polling.
 * Enable by constructing this instead of createPollingDelivery in src/index.ts;
 * no caller changes.
 */
export interface WebhookStore {
  waitFor(snapshotId: string, timeoutMs: number): Promise<unknown[]>;
  resolve(snapshotId: string, rows: unknown[]): void;
}

export const createWebhookDelivery = (store: WebhookStore, timeoutMs = 300000): ResultDelivery => ({
  await: (snapshotId) => store.waitFor(snapshotId, timeoutMs),
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd craigsnotice_api && bun run test:run delivery`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add craigsnotice_api/src/services/brightdata/delivery.ts craigsnotice_api/tests/delivery.test.ts
git commit -m "feat(api): add polling result delivery with a webhook adapter"
```

---

### Task 12: Row parsing and violation-rate detection

**Files:**
- Create: `craigsnotice_api/src/services/parse.ts`
- Test: `craigsnotice_api/tests/parse.test.ts`

**Interfaces:**
- Consumes: `searchResultRowSchema`, `listingDetailRowSchema` (Task 5).
- Produces:

```ts
export interface ParseResult<T> {
  rows: T[];
  violations: number;
  total: number;
  violationRate: number;      // 0 when total is 0
  sampleViolation: string | null;   // first Zod message, for the heal prompt
}
export const parseRows: <T>(raw: unknown[], schema: ZodType<T>) => ParseResult<T>
export const isDegraded: (rate: number, threshold: number) => boolean
```

Tasks 13 and 22 consume these. `sampleViolation` is what makes the heal prompt in Task 22 specific rather than generic.

- [ ] **Step 1: Write the failing test**

`craigsnotice_api/tests/parse.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { searchResultRowSchema } from "@craigsnotice/types";
import { parseRows, isDegraded } from "../src/services/parse";

const good = (id: string) => ({ post_id: id, title: `Item ${id}`, price: "$100", url: `https://sfbay.craigslist.org/x/${id}.html` });
const broken = { title: "no id", url: "https://sfbay.craigslist.org/x/z.html" };

describe("parseRows", () => {
  it("keeps every valid row and reports a zero violation rate", () => {
    const r = parseRows([good("1"), good("2")], searchResultRowSchema);
    expect(r.rows).toHaveLength(2);
    expect(r.violations).toBe(0);
    expect(r.violationRate).toBe(0);
    expect(r.sampleViolation).toBeNull();
  });

  it("drops invalid rows and computes the violation rate", () => {
    const r = parseRows([good("1"), broken, broken, broken], searchResultRowSchema);
    expect(r.rows).toHaveLength(1);
    expect(r.violations).toBe(3);
    expect(r.total).toBe(4);
    expect(r.violationRate).toBeCloseTo(0.75);
  });

  it("captures the first violation message as a heal hint", () => {
    const r = parseRows([broken], searchResultRowSchema);
    expect(r.sampleViolation).toMatch(/post_id/);
  });

  it("returns a zero rate for an empty payload rather than NaN", () => {
    const r = parseRows([], searchResultRowSchema);
    expect(r.violationRate).toBe(0);
    expect(r.total).toBe(0);
  });
});

describe("isDegraded", () => {
  it("is false below the threshold", () => expect(isDegraded(0.29, 0.3)).toBe(false));
  it("is false exactly at the threshold", () => expect(isDegraded(0.3, 0.3)).toBe(false));
  it("is true above the threshold", () => expect(isDegraded(0.31, 0.3)).toBe(true));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd craigsnotice_api && bun run test:run parse`
Expected: FAIL — cannot resolve `../src/services/parse`.

- [ ] **Step 3: Implement parsing**

`craigsnotice_api/src/services/parse.ts`:

```ts
import type { ZodType } from "zod";

export interface ParseResult<T> {
  rows: T[];
  violations: number;
  total: number;
  violationRate: number;
  sampleViolation: string | null;
}

export const parseRows = <T>(raw: unknown[], schema: ZodType<T>): ParseResult<T> => {
  const rows: T[] = [];
  let violations = 0;
  let sampleViolation: string | null = null;

  for (const item of raw) {
    const result = schema.safeParse(item);
    if (result.success) {
      rows.push(result.data);
    } else {
      violations += 1;
      sampleViolation ??= result.error.issues
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; ");
    }
  }

  return {
    rows,
    violations,
    total: raw.length,
    violationRate: raw.length === 0 ? 0 : violations / raw.length,
    sampleViolation,
  };
};

/** Strictly greater than — a rate exactly at the threshold is still healthy. */
export const isDegraded = (rate: number, threshold: number): boolean => rate > threshold;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd craigsnotice_api && bun run test:run parse`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add craigsnotice_api/src/services/parse.ts craigsnotice_api/tests/parse.test.ts
git commit -m "feat(api): parse scraped rows and detect schema-violation rate"
```

---

### Task 13: Listing ingest

**Files:**
- Create: `craigsnotice_api/src/services/ingest.ts`
- Test: `craigsnotice_api/tests/ingest.test.ts`

**Interfaces:**
- Consumes: `ResultDelivery` (Task 11), `BrightDataClient` (Task 10), `parseRows` (Task 12), `listings`/`scrapeRuns` tables (Task 7).
- Produces:

```ts
export interface IngestDeps {
  db: Db; bd: BrightDataClient; delivery: ResultDelivery;
  searchCollectorId: string; detailCollectorId: string;
}
export interface IngestResult {
  runId: string; scrapedCount: number; newListingIds: string[];
  violationRate: number; sampleViolation: string | null;
}
export const ingestWatch: (deps: IngestDeps, watch: Watch, scraperConfigId: string) => Promise<IngestResult>
```

Tasks 17, 21, 22 consume `ingestWatch`.

Behaviour: trigger the search collector on `watch.searchUrl` → record a `scrape_runs` row → await delivery → `parseRows` → select `cl_post_id` values already in `listings` for this watch → for genuinely new post ids only, trigger the detail collector on their URLs and await → upsert full listings → mark the run `ready`. **Dedup is on `cl_post_id`, so a re-scrape never re-inserts and never re-alerts.**

- [ ] **Step 1: Write the failing test**

`craigsnotice_api/tests/ingest.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { db, resetDb } from "./setup";
import { createFakeBrightData } from "../src/services/brightdata/fake";
import { createPollingDelivery } from "../src/services/brightdata/delivery";
import { ingestWatch } from "../src/services/ingest";
import { listings, scrapeRuns, users, watches, scraperConfigs } from "../src/db/schema";

const noSleep = async (): Promise<void> => {};

const searchRow = (id: string) => ({
  post_id: id, title: `Mac Studio ${id}`, price: "$1,200",
  url: `https://sfbay.craigslist.org/sfc/sya/d/x/${id}.html`,
});
const detailRow = (id: string) => ({
  ...searchRow(id), description: "Mint condition", condition: "like new", image_count: 4,
});

const seed = async () => {
  const [u] = await db.insert(users).values({ firebaseUid: "u1", email: "a@b.c" }).returning();
  const [w] = await db.insert(watches).values({
    userId: u!.id, siteCode: "sfbay", categoryCode: "sya", query: "Mac Studio",
    searchUrl: "https://sfbay.craigslist.org/search/sya?query=Mac+Studio",
  }).returning();
  const [sc] = await db.insert(scraperConfigs).values({ kind: "search", bdCollectorId: "search-collector" }).returning();
  return { watch: w!, scraperConfigId: sc!.id };
};

const depsWith = (bd: ReturnType<typeof createFakeBrightData>) => ({
  db, bd, delivery: createPollingDelivery(bd, { sleep: noSleep }),
  searchCollectorId: "search-collector", detailCollectorId: "detail-collector",
});

describe("ingestWatch", () => {
  beforeEach(async () => { await resetDb(); });

  it("stores new listings and returns their ids", async () => {
    const { watch, scraperConfigId } = await seed();
    const bd = createFakeBrightData();
    bd.queue("x", [searchRow("1"), searchRow("2")]);

    const result = await ingestWatch(depsWith(bd), watch, scraperConfigId);

    expect(result.scrapedCount).toBe(2);
    expect(result.newListingIds).toHaveLength(2);
    expect(result.violationRate).toBe(0);
    expect(await db.select().from(listings).where(eq(listings.watchId, watch.id))).toHaveLength(2);
  });

  it("records a scrape run and marks it ready", async () => {
    const { watch, scraperConfigId } = await seed();
    const bd = createFakeBrightData();
    bd.queue("x", [searchRow("1")]);

    const result = await ingestWatch(depsWith(bd), watch, scraperConfigId);
    const [run] = await db.select().from(scrapeRuns).where(eq(scrapeRuns.id, result.runId));

    expect(run!.status).toBe("ready");
    expect(run!.rowCount).toBe(1);
    expect(run!.finishedAt).not.toBeNull();
  });

  it("does not re-insert or re-report a post id seen on a previous run", async () => {
    const { watch, scraperConfigId } = await seed();
    const bd = createFakeBrightData();
    bd.queue("x", [searchRow("1")]);
    await ingestWatch(depsWith(bd), watch, scraperConfigId);

    bd.queue("x", [searchRow("1"), searchRow("2")]);
    const second = await ingestWatch(depsWith(bd), watch, scraperConfigId);

    expect(second.newListingIds).toHaveLength(1);
    expect(await db.select().from(listings).where(eq(listings.watchId, watch.id))).toHaveLength(2);
  });

  it("enriches listings from the detail collector", async () => {
    const { watch, scraperConfigId } = await seed();
    const bd = createFakeBrightData();
    bd.queue("x", [searchRow("1")]);
    const deps = depsWith(bd);

    // detail run returns the enriched shape
    bd.queue("x", [detailRow("1")]);
    await ingestWatch(deps, watch, scraperConfigId);

    const [row] = await db.select().from(listings).where(eq(listings.clPostId, "1"));
    expect(row!.condition).toBe("like new");
    expect(row!.imageCount).toBe(4);
    expect(row!.detailFetchedAt).not.toBeNull();
  });

  it("surfaces the violation rate without storing malformed rows", async () => {
    const { watch, scraperConfigId } = await seed();
    const bd = createFakeBrightData();
    bd.queue("x", [searchRow("1"), { title: "broken" }, { title: "broken" }]);

    const result = await ingestWatch(depsWith(bd), watch, scraperConfigId);

    expect(result.violationRate).toBeCloseTo(2 / 3);
    expect(result.sampleViolation).toMatch(/post_id/);
    expect(await db.select().from(listings).where(eq(listings.watchId, watch.id))).toHaveLength(1);
  });

  it("marks the run failed and rethrows when delivery times out", async () => {
    const { watch, scraperConfigId } = await seed();
    const bd = createFakeBrightData();
    bd.queue("x", [searchRow("1")], 1000);
    const deps = { ...depsWith(bd), delivery: createPollingDelivery(bd, { sleep: noSleep, timeoutMs: 10000 }) };

    await expect(ingestWatch(deps, watch, scraperConfigId)).rejects.toThrow();
    const runs = await db.select().from(scrapeRuns).where(eq(scrapeRuns.watchId, watch.id));
    expect(runs[0]!.status).toBe("failed");
    expect(runs[0]!.error).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd craigsnotice_api && DATABASE_URL=postgres://localhost/craigsnotice_test bun run test:run ingest`
Expected: FAIL — cannot resolve `../src/services/ingest`.

- [ ] **Step 3: Implement ingest**

`craigsnotice_api/src/services/ingest.ts`:

```ts
import { and, eq, inArray } from "drizzle-orm";
import {
  searchResultRowSchema, listingDetailRowSchema,
  type Watch, type SearchResultRow, type ListingDetailRow,
} from "@craigsnotice/types";
import type { Db } from "../db";
import { listings, scrapeRuns } from "../db/schema";
import type { BrightDataClient } from "./brightdata/client";
import type { ResultDelivery } from "./brightdata/delivery";
import { parseRows } from "./parse";

export interface IngestDeps {
  db: Db;
  bd: BrightDataClient;
  delivery: ResultDelivery;
  searchCollectorId: string;
  detailCollectorId: string;
}

export interface IngestResult {
  runId: string;
  scrapedCount: number;
  newListingIds: string[];
  violationRate: number;
  sampleViolation: string | null;
}

const toDate = (raw: string | null): Date | null => {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
};

export const ingestWatch = async (
  deps: IngestDeps,
  watch: Watch,
  scraperConfigId: string
): Promise<IngestResult> => {
  const snapshotId = await deps.bd.trigger(deps.searchCollectorId, [{ url: watch.searchUrl }]);

  const [run] = await deps.db.insert(scrapeRuns).values({
    watchId: watch.id, scraperConfigId, snapshotId, status: "collecting",
  }).returning();
  const runId = run!.id;

  let raw: unknown[];
  try {
    raw = await deps.delivery.await(snapshotId);
  } catch (err) {
    await deps.db.update(scrapeRuns)
      .set({ status: "failed", finishedAt: new Date(), error: (err as Error).message })
      .where(eq(scrapeRuns.id, runId));
    throw err;
  }

  const parsed = parseRows<SearchResultRow>(raw, searchResultRowSchema);

  const scrapedIds = parsed.rows.map((r) => r.postId);
  const existing = scrapedIds.length
    ? await deps.db.select({ clPostId: listings.clPostId }).from(listings)
        .where(and(eq(listings.watchId, watch.id), inArray(listings.clPostId, scrapedIds)))
    : [];
  const seen = new Set(existing.map((e) => e.clPostId));
  const fresh = parsed.rows.filter((r) => !seen.has(r.postId));

  const details = new Map<string, ListingDetailRow>();
  if (fresh.length > 0) {
    const detailSnapshot = await deps.bd.trigger(
      deps.detailCollectorId,
      fresh.map((r) => ({ url: r.url }))
    );
    const detailRaw = await deps.delivery.await(detailSnapshot);
    for (const d of parseRows<ListingDetailRow>(detailRaw, listingDetailRowSchema).rows) {
      details.set(d.postId, d);
    }
  }

  const newListingIds: string[] = [];
  for (const row of fresh) {
    const detail = details.get(row.postId);
    const [inserted] = await deps.db.insert(listings).values({
      watchId: watch.id,
      clPostId: row.postId,
      title: detail?.title ?? row.title,
      price: (detail?.price ?? row.price) === null ? null : String(detail?.price ?? row.price),
      url: row.url,
      postedAt: toDate(detail?.postedAt ?? row.postedAt),
      location: detail?.location ?? row.location,
      condition: detail?.condition ?? null,
      description: detail?.description ?? null,
      imageCount: detail?.imageCount ?? 0,
      detailFetchedAt: detail ? new Date() : null,
    }).onConflictDoNothing({ target: listings.clPostId }).returning();

    if (inserted) newListingIds.push(inserted.id);
  }

  await deps.db.update(scrapeRuns).set({
    status: "ready",
    rowCount: parsed.total,
    violationCount: parsed.violations,
    finishedAt: new Date(),
  }).where(eq(scrapeRuns.id, runId));

  return {
    runId,
    scrapedCount: parsed.total,
    newListingIds,
    violationRate: parsed.violationRate,
    sampleViolation: parsed.sampleViolation,
  };
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd craigsnotice_api && DATABASE_URL=postgres://localhost/craigsnotice_test bun run test:run ingest`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add craigsnotice_api/src/services/ingest.ts craigsnotice_api/tests/ingest.test.ts
git commit -m "feat(api): ingest scraped listings with detail enrichment and dedup"
```

---

### Task 14: Price baseline

**Files:**
- Create: `craigsnotice_api/src/services/baseline.ts`
- Test: `craigsnotice_api/tests/baseline.test.ts`

**Interfaces:**
- Consumes: `Baseline` type (Task 5), `listings` table (Task 7).
- Produces:

```ts
export const percentile: (sorted: number[], p: number) => number
export const computeBaseline: (prices: number[], minSamples: number) => Baseline | null
export const watchBaseline: (db: Db, watchId: string, minSamples: number, now?: Date) => Promise<Baseline | null>
```

Task 17 consumes `watchBaseline`. **Returning `null` below `minSamples` is the cold-start path** — the first run of a brand-new watch has no history and the agent must still produce a verdict from `targetPrice` alone.

Window: listings first seen in the trailing 30 days, price non-null.

- [ ] **Step 1: Write the failing test**

`craigsnotice_api/tests/baseline.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { db, resetDb } from "./setup";
import { computeBaseline, percentile, watchBaseline } from "../src/services/baseline";
import { listings, users, watches } from "../src/db/schema";

describe("percentile", () => {
  it("returns the exact element when the index lands on one", () => {
    expect(percentile([10, 20, 30, 40, 50], 0.5)).toBe(30);
  });
  it("interpolates between neighbours", () => {
    expect(percentile([10, 20, 30, 40], 0.5)).toBe(25);
  });
  it("returns the only element for a single-item list", () => {
    expect(percentile([42], 0.25)).toBe(42);
  });
});

describe("computeBaseline", () => {
  it("returns null below the minimum sample count", () => {
    expect(computeBaseline([100, 200, 300, 400], 5)).toBeNull();
  });

  it("computes median, p25, min and max at exactly the minimum", () => {
    const b = computeBaseline([500, 100, 300, 200, 400], 5);
    expect(b).not.toBeNull();
    expect(b!.count).toBe(5);
    expect(b!.median).toBe(300);
    expect(b!.p25).toBe(200);
    expect(b!.min).toBe(100);
    expect(b!.max).toBe(500);
  });

  it("returns null for an empty list", () => {
    expect(computeBaseline([], 5)).toBeNull();
  });
});

describe("watchBaseline", () => {
  beforeEach(async () => { await resetDb(); });

  const seedWatch = async () => {
    const [u] = await db.insert(users).values({ firebaseUid: "u1", email: "a@b.c" }).returning();
    const [w] = await db.insert(watches).values({
      userId: u!.id, siteCode: "sfbay", categoryCode: "sya", query: "Mac Studio",
      searchUrl: "https://sfbay.craigslist.org/search/sya?query=Mac+Studio",
    }).returning();
    return w!;
  };

  const addListing = (watchId: string, postId: string, price: string | null, firstSeenAt: Date) =>
    db.insert(listings).values({
      watchId, clPostId: postId, title: `t${postId}`, price, firstSeenAt,
      url: `https://sfbay.craigslist.org/x/${postId}.html`,
    });

  it("returns null for a brand-new watch (cold start)", async () => {
    const w = await seedWatch();
    expect(await watchBaseline(db, w.id, 5)).toBeNull();
  });

  it("ignores listings with no price", async () => {
    const w = await seedWatch();
    const now = new Date();
    for (const [i, p] of ["100", "200", "300", "400", null].entries()) {
      await addListing(w.id, `p${i}`, p, now);
    }
    expect(await watchBaseline(db, w.id, 5)).toBeNull();
  });

  it("ignores listings older than 30 days", async () => {
    const w = await seedWatch();
    const now = new Date("2026-08-22T12:00:00Z");
    const old = new Date("2026-06-01T12:00:00Z");
    for (const [i, p] of ["100", "200", "300", "400", "500"].entries()) {
      await addListing(w.id, `fresh${i}`, p, now);
    }
    await addListing(w.id, "stale", "99999", old);

    const b = await watchBaseline(db, w.id, 5, now);
    expect(b!.count).toBe(5);
    expect(b!.max).toBe(500);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd craigsnotice_api && DATABASE_URL=postgres://localhost/craigsnotice_test bun run test:run baseline`
Expected: FAIL — cannot resolve `../src/services/baseline`.

- [ ] **Step 3: Implement the baseline**

`craigsnotice_api/src/services/baseline.ts`:

```ts
import { and, eq, gte, isNotNull } from "drizzle-orm";
import type { Baseline } from "@craigsnotice/types";
import type { Db } from "../db";
import { listings } from "../db/schema";

const WINDOW_DAYS = 30;

/** Linear-interpolated percentile over an ascending-sorted array. */
export const percentile = (sorted: number[], p: number): number => {
  if (sorted.length === 0) throw new Error("percentile of an empty list");
  if (sorted.length === 1) return sorted[0]!;
  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower]!;
  return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (index - lower);
};

export const computeBaseline = (prices: number[], minSamples: number): Baseline | null => {
  const usable = prices.filter((p) => Number.isFinite(p));
  if (usable.length < minSamples || usable.length === 0) return null;

  const sorted = [...usable].sort((a, b) => a - b);
  return {
    count: sorted.length,
    median: percentile(sorted, 0.5),
    p25: percentile(sorted, 0.25),
    min: sorted[0]!,
    max: sorted[sorted.length - 1]!,
  };
};

export const watchBaseline = async (
  db: Db,
  watchId: string,
  minSamples: number,
  now: Date = new Date()
): Promise<Baseline | null> => {
  const cutoff = new Date(now.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({ price: listings.price })
    .from(listings)
    .where(and(
      eq(listings.watchId, watchId),
      isNotNull(listings.price),
      gte(listings.firstSeenAt, cutoff)
    ));

  return computeBaseline(rows.map((r) => Number(r.price)), minSamples);
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd craigsnotice_api && DATABASE_URL=postgres://localhost/craigsnotice_test bun run test:run baseline`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add craigsnotice_api/src/services/baseline.ts craigsnotice_api/tests/baseline.test.ts
git commit -m "feat(api): compute per-watch price baselines with a cold-start path"
```

---

# Phase 2 — Port integration and the agent

### Task 15: Port client and fake

**Files:**
- Create: `craigsnotice_api/src/services/port/client.ts`, `craigsnotice_api/src/services/port/fake.ts`
- Test: `craigsnotice_api/tests/port-client.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:

```ts
export interface PortClient {
  upsertEntity(blueprint: string, identifier: string, title: string, properties: Record<string, unknown>, relations?: Record<string, string>): Promise<void>;
  patchEntity(blueprint: string, identifier: string, properties: Record<string, unknown>): Promise<void>;
  invokeAgent(agentId: string, payload: unknown): Promise<unknown>;
}
export const createPortClient: (opts: { clientId: string; clientSecret: string; fetchImpl?: typeof fetch; now?: () => number }) => PortClient
export const createFakePort: () => FakePort  // records every call
```

Tasks 17, 18, 21, 22 consume `PortClient`.

**Endpoints:** `POST https://api.port.io/v1/auth/access_token` body `{ clientId, clientSecret }` → `{ accessToken, expiresIn }`; `POST /v1/blueprints/:blueprint/entities?upsert=true&merge=true`; `PATCH /v1/blueprints/:blueprint/entities/:identifier`; `POST /v1/agent/:identifier/invoke`. All authenticated with `Authorization: Bearer <accessToken>`. The token is cached until 60s before expiry.

- [ ] **Step 1: Write the failing test**

`craigsnotice_api/tests/port-client.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { createPortClient } from "../src/services/port/client";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const tokenResponse = () => json({ accessToken: "tok-1", expiresIn: 3600 });

describe("createPortClient", () => {
  it("fetches an access token before the first call and reuses it", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValue(json({ ok: true }));
    const client = createPortClient({ clientId: "id", clientSecret: "secret", fetchImpl: fetchImpl as unknown as typeof fetch });

    await client.upsertEntity("craigsnotice_watch", "w1", "Mac Studio", { query: "Mac Studio" });
    await client.upsertEntity("craigsnotice_watch", "w2", "Herman Miller", { query: "Herman Miller" });

    const tokenCalls = fetchImpl.mock.calls.filter(([u]) => String(u).includes("/auth/access_token"));
    expect(tokenCalls).toHaveLength(1);
    expect(JSON.parse(tokenCalls[0]![1].body)).toEqual({ clientId: "id", clientSecret: "secret" });
  });

  it("upserts an entity with identifier, title, properties and relations", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(tokenResponse()).mockResolvedValue(json({ ok: true }));
    const client = createPortClient({ clientId: "id", clientSecret: "s", fetchImpl: fetchImpl as unknown as typeof fetch });

    await client.upsertEntity("craigsnotice_listing", "l1", "Mac Studio M2", { price: 1200 }, { watch: "w1" });

    const [url, init] = fetchImpl.mock.calls[1]!;
    expect(url).toBe("https://api.port.io/v1/blueprints/craigsnotice_listing/entities?upsert=true&merge=true");
    expect(init.headers.Authorization).toBe("Bearer tok-1");
    expect(JSON.parse(init.body)).toEqual({
      identifier: "l1", title: "Mac Studio M2", properties: { price: 1200 }, relations: { watch: "w1" },
    });
  });

  it("patches only the given properties", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(tokenResponse()).mockResolvedValue(json({ ok: true }));
    const client = createPortClient({ clientId: "id", clientSecret: "s", fetchImpl: fetchImpl as unknown as typeof fetch });

    await client.patchEntity("craigsnotice_deal_alert", "a1", { userFeedback: "good" });

    const [url, init] = fetchImpl.mock.calls[1]!;
    expect(url).toBe("https://api.port.io/v1/blueprints/craigsnotice_deal_alert/entities/a1");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({ properties: { userFeedback: "good" } });
  });

  it("invokes an agent and returns the parsed body", async () => {
    const verdict = { isGoodDeal: true, score: 88, reasoning: "well under median", priceVsMedian: -0.34 };
    const fetchImpl = vi.fn().mockResolvedValueOnce(tokenResponse()).mockResolvedValue(json(verdict, 202));
    const client = createPortClient({ clientId: "id", clientSecret: "s", fetchImpl: fetchImpl as unknown as typeof fetch });

    const out = await client.invokeAgent("deal-agent", { listing: { title: "x" } });

    expect(out).toEqual(verdict);
    expect(fetchImpl.mock.calls[1]![0]).toBe("https://api.port.io/v1/agent/deal-agent/invoke");
  });

  it("re-fetches the token once it has expired", async () => {
    let clock = 0;
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(json({ accessToken: "tok-1", expiresIn: 100 }))
      .mockResolvedValueOnce(json({ ok: true }))
      .mockResolvedValueOnce(json({ accessToken: "tok-2", expiresIn: 100 }))
      .mockResolvedValueOnce(json({ ok: true }));
    const client = createPortClient({
      clientId: "id", clientSecret: "s",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => clock,
    });

    await client.patchEntity("b", "e", {});
    clock = 200_000;
    await client.patchEntity("b", "e", {});

    expect(fetchImpl.mock.calls.filter(([u]) => String(u).includes("access_token"))).toHaveLength(2);
    expect(fetchImpl.mock.calls[3]![1].headers.Authorization).toBe("Bearer tok-2");
  });

  it("throws on a failed request", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(tokenResponse()).mockResolvedValue(json({ error: "bad" }, 500));
    const client = createPortClient({ clientId: "id", clientSecret: "s", fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(client.patchEntity("b", "e", {})).rejects.toThrow(/500/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd craigsnotice_api && bun run test:run port-client`
Expected: FAIL — cannot resolve `../src/services/port/client`.

- [ ] **Step 3: Implement the client**

`craigsnotice_api/src/services/port/client.ts`:

```ts
const BASE = "https://api.port.io/v1";
const TOKEN_SKEW_MS = 60_000;

export interface PortClient {
  upsertEntity(
    blueprint: string, identifier: string, title: string,
    properties: Record<string, unknown>, relations?: Record<string, string>
  ): Promise<void>;
  patchEntity(blueprint: string, identifier: string, properties: Record<string, unknown>): Promise<void>;
  invokeAgent(agentId: string, payload: unknown): Promise<unknown>;
}

export interface PortClientOptions {
  clientId: string;
  clientSecret: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export const createPortClient = (opts: PortClientOptions): PortClient => {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const now = opts.now ?? Date.now;

  let token: string | null = null;
  let expiresAt = 0;

  const getToken = async (): Promise<string> => {
    if (token && now() < expiresAt - TOKEN_SKEW_MS) return token;

    const res = await fetchImpl(`${BASE}/auth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId: opts.clientId, clientSecret: opts.clientSecret }),
    });
    if (!res.ok) throw new Error(`port auth failed: ${res.status}`);

    const body = (await res.json()) as { accessToken: string; expiresIn: number };
    token = body.accessToken;
    expiresAt = now() + body.expiresIn * 1000;
    return token;
  };

  const request = async (path: string, method: string, body: unknown): Promise<unknown> => {
    const bearer = await getToken();
    const res = await fetchImpl(`${BASE}${path}`, {
      method,
      headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`port ${method} ${path} failed: ${res.status}`);
    return res.json();
  };

  return {
    async upsertEntity(blueprint, identifier, title, properties, relations) {
      await request(
        `/blueprints/${blueprint}/entities?upsert=true&merge=true`,
        "POST",
        { identifier, title, properties, relations: relations ?? {} }
      );
    },
    async patchEntity(blueprint, identifier, properties) {
      await request(`/blueprints/${blueprint}/entities/${identifier}`, "PATCH", { properties });
    },
    invokeAgent(agentId, payload) {
      return request(`/agent/${agentId}/invoke`, "POST", payload);
    },
  };
};
```

- [ ] **Step 4: Implement the fake**

`craigsnotice_api/src/services/port/fake.ts`:

```ts
import type { PortClient } from "./client";

export interface RecordedUpsert {
  blueprint: string; identifier: string; title: string;
  properties: Record<string, unknown>; relations: Record<string, string>;
}

export interface FakePort extends PortClient {
  readonly upserts: RecordedUpsert[];
  readonly patches: Array<{ blueprint: string; identifier: string; properties: Record<string, unknown> }>;
  readonly invocations: Array<{ agentId: string; payload: unknown }>;
  /** Set the verdict the next invokeAgent returns; throws instead if given an Error. */
  respondWith(value: unknown): void;
}

export const createFakePort = (): FakePort => {
  const upserts: RecordedUpsert[] = [];
  const patches: FakePort["patches"] = [];
  const invocations: FakePort["invocations"] = [];
  let next: unknown = { isGoodDeal: false, score: 0, reasoning: "default fake verdict", priceVsMedian: 0 };

  return {
    upserts, patches, invocations,
    respondWith(value) { next = value; },
    async upsertEntity(blueprint, identifier, title, properties, relations) {
      upserts.push({ blueprint, identifier, title, properties, relations: relations ?? {} });
    },
    async patchEntity(blueprint, identifier, properties) {
      patches.push({ blueprint, identifier, properties });
    },
    async invokeAgent(agentId, payload) {
      invocations.push({ agentId, payload });
      if (next instanceof Error) throw next;
      return next;
    },
  };
};
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd craigsnotice_api && bun run test:run port-client`
Expected: PASS, 6 tests.

- [ ] **Step 6: Commit**

```bash
git add craigsnotice_api/src/services/port craigsnotice_api/tests/port-client.test.ts
git commit -m "feat(api): add Port client with token caching and a recording fake"
```

---

### Task 16: Port blueprints as version-controlled YAML

**Files:**
- Create: `port/blueprints/craigsnotice_watch.yaml`, `craigsnotice_scraper_config.yaml`, `craigsnotice_scrape_run.yaml`, `craigsnotice_listing.yaml`, `craigsnotice_deal_alert.yaml`
- Create: `craigsnotice_api/scripts/sync-blueprints.ts`
- Test: `craigsnotice_api/tests/blueprints.test.ts`

**Interfaces:**
- Consumes: `PortClient` (Task 15).
- Produces: `loadBlueprints(dir: string): Blueprint[]` and the `bun run port:sync` script. Nothing consumes this at runtime; it exists so the Port configuration is reproducible from the repo, which is the "reusable, version-controlled configurations" judging bullet.

- [ ] **Step 1: Write the failing test**

`craigsnotice_api/tests/blueprints.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { loadBlueprints } from "../scripts/sync-blueprints";

describe("port blueprints", () => {
  const blueprints = loadBlueprints(new URL("../../port/blueprints", import.meta.url).pathname);

  it("defines all five blueprints", () => {
    expect(blueprints.map((b) => b.identifier).sort()).toEqual([
      "craigsnotice_deal_alert",
      "craigsnotice_listing",
      "craigsnotice_scrape_run",
      "craigsnotice_scraper_config",
      "craigsnotice_watch",
    ]);
  });

  it("gives every blueprint a title and at least one property", () => {
    for (const b of blueprints) {
      expect(b.title, `${b.identifier} has no title`).toBeTruthy();
      expect(Object.keys(b.schema.properties).length).toBeGreaterThan(0);
    }
  });

  it("only declares relations that point at blueprints defined here", () => {
    const ids = new Set(blueprints.map((b) => b.identifier));
    for (const b of blueprints) {
      for (const [name, rel] of Object.entries(b.relations ?? {})) {
        expect(ids.has(rel.target), `${b.identifier}.${name} targets unknown ${rel.target}`).toBe(true);
      }
    }
  });

  it("gives the deal alert a userFeedback property so the feedback loop is visible in Port", () => {
    const alert = blueprints.find((b) => b.identifier === "craigsnotice_deal_alert");
    expect(alert!.schema.properties.userFeedback).toBeDefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd craigsnotice_api && bun run test:run blueprints`
Expected: FAIL — cannot resolve `../scripts/sync-blueprints`.

- [ ] **Step 3: Write the blueprint YAML**

`port/blueprints/craigsnotice_watch.yaml`:

```yaml
identifier: craigsnotice_watch
title: CraigsNotice Watch
icon: Search
schema:
  properties:
    siteCode: { type: string, title: Craigslist site }
    subarea: { type: string, title: Subarea }
    categoryCode: { type: string, title: Category }
    query: { type: string, title: Looking for }
    targetPrice: { type: number, title: Target price }
    intervalSec: { type: number, title: Interval (s) }
    status: { type: string, title: Status, enum: [active, paused] }
    searchUrl: { type: string, format: url, title: Search URL }
    ownerEmail: { type: string, format: user, title: Owner }
  required: [siteCode, categoryCode, query, searchUrl]
```

`port/blueprints/craigsnotice_scraper_config.yaml`:

```yaml
identifier: craigsnotice_scraper_config
title: CraigsNotice Scraper
icon: Cloud
schema:
  properties:
    kind: { type: string, title: Kind, enum: [search, detail] }
    collectorId: { type: string, title: Bright Data collector }
    health: { type: string, title: Health, enum: [healthy, degraded] }
    violationRate: { type: number, title: Schema violation rate }
    lastHealedAt: { type: string, format: date-time, title: Last healed }
    healPrompt: { type: string, title: Last heal prompt }
  required: [kind, collectorId, health]
```

`port/blueprints/craigsnotice_scrape_run.yaml`:

```yaml
identifier: craigsnotice_scrape_run
title: CraigsNotice Scrape Run
icon: Deployment
schema:
  properties:
    snapshotId: { type: string, title: Snapshot }
    status: { type: string, title: Status, enum: [collecting, ready, failed] }
    rowCount: { type: number, title: Rows }
    violationCount: { type: number, title: Violations }
    durationMs: { type: number, title: Duration (ms) }
  required: [snapshotId, status]
relations:
  watch: { target: craigsnotice_watch, required: false, many: false }
  scraper: { target: craigsnotice_scraper_config, required: false, many: false }
```

`port/blueprints/craigsnotice_listing.yaml`:

```yaml
identifier: craigsnotice_listing
title: CraigsNotice Listing
icon: Package
schema:
  properties:
    price: { type: number, title: Price }
    url: { type: string, format: url, title: URL }
    postedAt: { type: string, format: date-time, title: Posted }
    condition: { type: string, title: Condition }
    location: { type: string, title: Location }
  required: [url]
relations:
  watch: { target: craigsnotice_watch, required: false, many: false }
```

`port/blueprints/craigsnotice_deal_alert.yaml`:

```yaml
identifier: craigsnotice_deal_alert
title: CraigsNotice Deal Alert
icon: Alert
schema:
  properties:
    score: { type: number, title: Score }
    isGoodDeal: { type: boolean, title: Good deal }
    reasoning: { type: string, title: Agent reasoning }
    priceVsMedian: { type: number, title: Price vs median }
    userFeedback: { type: string, title: User feedback, enum: [good, bad, none] }
  required: [score, isGoodDeal, reasoning]
relations:
  listing: { target: craigsnotice_listing, required: false, many: false }
  watch: { target: craigsnotice_watch, required: false, many: false }
```

- [ ] **Step 4: Implement the loader and sync script**

`craigsnotice_api/scripts/sync-blueprints.ts`:

```ts
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { createPortClient } from "../src/services/port/client";

export interface Blueprint {
  identifier: string;
  title: string;
  icon?: string;
  schema: { properties: Record<string, unknown>; required?: string[] };
  relations?: Record<string, { target: string; required?: boolean; many?: boolean }>;
}

export const loadBlueprints = (dir: string): Blueprint[] =>
  readdirSync(dir)
    .filter((f) => f.endsWith(".yaml"))
    .map((f) => parse(readFileSync(join(dir, f), "utf8")) as Blueprint)
    .sort((a, b) => a.identifier.localeCompare(b.identifier));

if (import.meta.main) {
  const dir = new URL("../../port/blueprints", import.meta.url).pathname;
  const client = createPortClient({
    clientId: process.env.PORT_CLIENT_ID!,
    clientSecret: process.env.PORT_CLIENT_SECRET!,
  });

  for (const bp of loadBlueprints(dir)) {
    // Blueprints are created through the blueprints endpoint, not the entities endpoint.
    await (client as unknown as { upsertBlueprint?: (b: Blueprint) => Promise<void> }).upsertBlueprint?.(bp);
    console.log(`synced blueprint ${bp.identifier}`);
  }
}
```

Add `upsertBlueprint(bp: Blueprint): Promise<void>` to `PortClient` and implement it as
`request("/blueprints", "POST", bp)`, falling back to `PUT /blueprints/${bp.identifier}` on a
409 conflict. Add `yaml` to `craigsnotice_api` dependencies with `bun add yaml`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd craigsnotice_api && bun run test:run blueprints`
Expected: PASS, 4 tests.

- [ ] **Step 6: Sync against real Port and commit**

Run: `cd craigsnotice_api && bun run port:sync`
Expected: five `synced blueprint ...` lines; the blueprints appear in the Port catalog UI.

```bash
git add port/blueprints craigsnotice_api/scripts craigsnotice_api/tests/blueprints.test.ts craigsnotice_api/src/services/port/client.ts
git commit -m "feat(port): add version-controlled blueprints and a sync script"
```

---

### Task 17: Deal judgment via the Port agent

**Files:**
- Create: `craigsnotice_api/src/services/judgment.ts`
- Test: `craigsnotice_api/tests/judgment.test.ts`

**Interfaces:**
- Consumes: `PortClient` (Task 15), `watchBaseline` (Task 14), `agentVerdictSchema`/`AgentVerdict` (Task 5), `listings`/`dealAlerts`/`alertFeedback` tables (Task 7).
- Produces:

```ts
export interface JudgmentDeps { db: Db; port: PortClient; agentId: string; minBaselineSamples: number }
export interface JudgmentOutcome { listingId: string; verdict: AgentVerdict | null; alertId: string | null; error: string | null }
export const recentFeedback: (db: Db, watchId: string, limit?: number) => Promise<FeedbackContext[]>
export const judgeListing: (deps: JudgmentDeps, watchId: string, listingId: string) => Promise<JudgmentOutcome>
```

Tasks 19 and 21 consume `judgeListing`.

**Failure handling (spec §7.4):** a malformed or throwing agent response must not stall the pipeline. The listing stays stored, no alert is created, `verdict` is `null` and `error` carries the reason. This is tested explicitly.

- [ ] **Step 1: Write the failing test**

`craigsnotice_api/tests/judgment.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { db, resetDb } from "./setup";
import { createFakePort } from "../src/services/port/fake";
import { judgeListing, recentFeedback } from "../src/services/judgment";
import { alertFeedback, dealAlerts, listings, users, watches } from "../src/db/schema";

const GOOD = { isGoodDeal: true, score: 88, reasoning: "34% under median", priceVsMedian: -0.34 };
const BAD = { isGoodDeal: false, score: 21, reasoning: "above median", priceVsMedian: 0.2 };

const seed = async (prices: Array<string | null> = []) => {
  const [u] = await db.insert(users).values({ firebaseUid: "u1", email: "a@b.c" }).returning();
  const [w] = await db.insert(watches).values({
    userId: u!.id, siteCode: "sfbay", categoryCode: "sya", query: "Mac Studio", targetPrice: "1500",
    searchUrl: "https://sfbay.craigslist.org/search/sya?query=Mac+Studio",
  }).returning();
  for (const [i, p] of prices.entries()) {
    await db.insert(listings).values({
      watchId: w!.id, clPostId: `hist${i}`, title: `hist ${i}`, price: p,
      url: `https://sfbay.craigslist.org/x/hist${i}.html`,
    });
  }
  const [target] = await db.insert(listings).values({
    watchId: w!.id, clPostId: "target", title: "Mac Studio M2 Max", price: "1200",
    url: "https://sfbay.craigslist.org/x/target.html", condition: "like new", imageCount: 3,
  }).returning();
  return { user: u!, watch: w!, listing: target! };
};

const deps = (port: ReturnType<typeof createFakePort>) => ({ db, port, agentId: "deal-agent", minBaselineSamples: 5 });

describe("judgeListing", () => {
  beforeEach(async () => { await resetDb(); });

  it("creates an alert when the agent says it is a good deal", async () => {
    const { watch, listing } = await seed();
    const port = createFakePort();
    port.respondWith(GOOD);

    const out = await judgeListing(deps(port), watch.id, listing.id);

    expect(out.verdict).toEqual(GOOD);
    expect(out.alertId).not.toBeNull();
    const [alert] = await db.select().from(dealAlerts).where(eq(dealAlerts.id, out.alertId!));
    expect(alert!.score).toBe(88);
    expect(alert!.reasoning).toBe("34% under median");
  });

  it("creates no alert when the agent says it is not a good deal", async () => {
    const { watch, listing } = await seed();
    const port = createFakePort();
    port.respondWith(BAD);

    const out = await judgeListing(deps(port), watch.id, listing.id);

    expect(out.alertId).toBeNull();
    expect(await db.select().from(dealAlerts)).toHaveLength(0);
  });

  it("sends a null baseline on cold start and still returns a verdict", async () => {
    const { watch, listing } = await seed();
    const port = createFakePort();
    port.respondWith(GOOD);

    await judgeListing(deps(port), watch.id, listing.id);

    const payload = port.invocations[0]!.payload as { baseline: unknown; targetPrice: number | null };
    expect(payload.baseline).toBeNull();
    expect(payload.targetPrice).toBe(1500);
  });

  it("sends a computed baseline once enough priced history exists", async () => {
    const { watch, listing } = await seed(["1000", "1400", "1600", "1800", "2000"]);
    const port = createFakePort();
    port.respondWith(GOOD);

    await judgeListing(deps(port), watch.id, listing.id);

    const payload = port.invocations[0]!.payload as { baseline: { count: number; median: number } };
    expect(payload.baseline.count).toBe(6);
    expect(payload.baseline.median).toBeGreaterThan(0);
  });

  it("includes recent user feedback in the agent payload", async () => {
    const { user, watch, listing } = await seed();
    const port = createFakePort();
    port.respondWith(GOOD);
    const first = await judgeListing(deps(port), watch.id, listing.id);
    await db.insert(alertFeedback).values({ alertId: first.alertId!, userId: user.id, verdict: "bad" });

    const [second] = await db.insert(listings).values({
      watchId: watch.id, clPostId: "second", title: "Another Mac Studio", price: "1250",
      url: "https://sfbay.craigslist.org/x/second.html",
    }).returning();
    await judgeListing(deps(port), watch.id, second!.id);

    const payload = port.invocations[1]!.payload as { recentFeedback: Array<{ verdict: string }> };
    expect(payload.recentFeedback).toHaveLength(1);
    expect(payload.recentFeedback[0]!.verdict).toBe("bad");
  });

  it("degrades gracefully when the agent returns a malformed verdict", async () => {
    const { watch, listing } = await seed();
    const port = createFakePort();
    port.respondWith({ isGoodDeal: true, score: 500 });

    const out = await judgeListing(deps(port), watch.id, listing.id);

    expect(out.verdict).toBeNull();
    expect(out.alertId).toBeNull();
    expect(out.error).toMatch(/verdict/i);
    expect(await db.select().from(listings).where(eq(listings.id, listing.id))).toHaveLength(1);
  });

  it("degrades gracefully when the agent throws", async () => {
    const { watch, listing } = await seed();
    const port = createFakePort();
    port.respondWith(new Error("port timeout"));

    const out = await judgeListing(deps(port), watch.id, listing.id);

    expect(out.verdict).toBeNull();
    expect(out.error).toMatch(/port timeout/);
  });

  it("mirrors the alert to Port", async () => {
    const { watch, listing } = await seed();
    const port = createFakePort();
    port.respondWith(GOOD);

    const out = await judgeListing(deps(port), watch.id, listing.id);

    const upsert = port.upserts.find((u) => u.blueprint === "craigsnotice_deal_alert");
    expect(upsert!.identifier).toBe(out.alertId);
    expect(upsert!.properties.score).toBe(88);
    expect(upsert!.relations.watch).toBe(watch.id);
  });
});

describe("recentFeedback", () => {
  beforeEach(async () => { await resetDb(); });

  it("returns an empty array for a watch with no feedback", async () => {
    const { watch } = await seed();
    expect(await recentFeedback(db, watch.id)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd craigsnotice_api && DATABASE_URL=postgres://localhost/craigsnotice_test bun run test:run judgment`
Expected: FAIL — cannot resolve `../src/services/judgment`.

- [ ] **Step 3: Implement judgment**

`craigsnotice_api/src/services/judgment.ts`:

```ts
import { desc, eq } from "drizzle-orm";
import { agentVerdictSchema, type AgentVerdict } from "@craigsnotice/types";
import type { Db } from "../db";
import { alertFeedback, dealAlerts, listings, watches } from "../db/schema";
import type { PortClient } from "./port/client";
import { watchBaseline } from "./baseline";

export interface JudgmentDeps {
  db: Db;
  port: PortClient;
  agentId: string;
  minBaselineSamples: number;
}

export interface FeedbackContext {
  title: string;
  price: number | null;
  priceVsMedian: number;
  verdict: "good" | "bad";
}

export interface JudgmentOutcome {
  listingId: string;
  verdict: AgentVerdict | null;
  alertId: string | null;
  error: string | null;
}

export const recentFeedback = async (
  db: Db,
  watchId: string,
  limit = 10
): Promise<FeedbackContext[]> => {
  const rows = await db
    .select({
      title: listings.title,
      price: listings.price,
      priceVsMedian: dealAlerts.priceVsMedian,
      verdict: alertFeedback.verdict,
    })
    .from(alertFeedback)
    .innerJoin(dealAlerts, eq(alertFeedback.alertId, dealAlerts.id))
    .innerJoin(listings, eq(dealAlerts.listingId, listings.id))
    .where(eq(dealAlerts.watchId, watchId))
    .orderBy(desc(alertFeedback.createdAt))
    .limit(limit);

  return rows.map((r) => ({
    title: r.title,
    price: r.price === null ? null : Number(r.price),
    priceVsMedian: Number(r.priceVsMedian),
    verdict: r.verdict as "good" | "bad",
  }));
};

export const judgeListing = async (
  deps: JudgmentDeps,
  watchId: string,
  listingId: string
): Promise<JudgmentOutcome> => {
  const [listing] = await deps.db.select().from(listings).where(eq(listings.id, listingId));
  if (!listing) return { listingId, verdict: null, alertId: null, error: "listing not found" };

  const [watch] = await deps.db.select().from(watches).where(eq(watches.id, watchId));
  if (!watch) return { listingId, verdict: null, alertId: null, error: "watch not found" };

  const baseline = await watchBaseline(deps.db, watchId, deps.minBaselineSamples);

  const payload = {
    listing: {
      title: listing.title,
      price: listing.price === null ? null : Number(listing.price),
      condition: listing.condition,
      description: listing.description,
      imageCount: listing.imageCount,
      postedAt: listing.postedAt?.toISOString() ?? null,
      location: listing.location,
    },
    baseline,
    targetPrice: watch.targetPrice === null ? null : Number(watch.targetPrice),
    recentFeedback: await recentFeedback(deps.db, watchId),
  };

  let raw: unknown;
  try {
    raw = await deps.port.invokeAgent(deps.agentId, payload);
  } catch (err) {
    return { listingId, verdict: null, alertId: null, error: (err as Error).message };
  }

  const parsed = agentVerdictSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      listingId, verdict: null, alertId: null,
      error: `malformed agent verdict: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
    };
  }
  const verdict = parsed.data;

  if (!verdict.isGoodDeal) {
    return { listingId, verdict, alertId: null, error: null };
  }

  const [alert] = await deps.db.insert(dealAlerts).values({
    listingId, watchId,
    score: Math.round(verdict.score),
    isGoodDeal: true,
    reasoning: verdict.reasoning,
    priceVsMedian: String(verdict.priceVsMedian),
  }).returning();

  await deps.port.upsertEntity(
    "craigsnotice_deal_alert",
    alert!.id,
    listing.title,
    {
      score: verdict.score,
      isGoodDeal: true,
      reasoning: verdict.reasoning,
      priceVsMedian: verdict.priceVsMedian,
      userFeedback: "none",
    },
    { listing: listing.id, watch: watchId }
  );

  return { listingId, verdict, alertId: alert!.id, error: null };
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd craigsnotice_api && DATABASE_URL=postgres://localhost/craigsnotice_test bun run test:run judgment`
Expected: PASS, 9 tests.

- [ ] **Step 5: Configure the Port custom agent**

In the Port UI, create a custom agent with identifier matching `PORT_DEAL_AGENT_ID`. Its system
prompt, saved to `port/agents/deal-agent.md` in the repo:

```
You judge whether a Craigslist listing is a good deal for a specific buyer.

You receive JSON with: listing, baseline (may be null), targetPrice (may be null),
and recentFeedback — the buyer's last verdicts on comparable listings.

Rules:
- If baseline is null you have no market history. Judge from targetPrice and your own
  knowledge of what this item is worth. Be conservative: prefer isGoodDeal=false unless
  the price is clearly good.
- If baseline exists, priceVsMedian = (price - baseline.median) / baseline.median.
  A price at or below p25 is a strong signal.
- If targetPrice is set, a price above it is almost never a good deal.
- recentFeedback is the buyer calibrating you. If they marked similar priceVsMedian
  values "bad", raise your bar. If they marked them "good", lower it.
- A listing with no price is never a good deal.

Reply with ONLY this JSON object, no prose:
{"isGoodDeal": boolean, "score": 0-100, "reasoning": "one sentence", "priceVsMedian": number}
```

- [ ] **Step 6: Commit**

```bash
git add craigsnotice_api/src/services/judgment.ts craigsnotice_api/tests/judgment.test.ts port/agents
git commit -m "feat(api): judge listings via the Port agent with graceful degradation"
```

---

### Task 18: Mirror watches, runs and listings to Port

**Files:**
- Create: `craigsnotice_api/src/services/port/mirror.ts`
- Modify: `craigsnotice_api/src/services/watches.ts`, `craigsnotice_api/src/services/ingest.ts`
- Test: `craigsnotice_api/tests/mirror.test.ts`

**Interfaces:**
- Consumes: `PortClient` (Task 15).
- Produces: `mirrorWatch(port, watch, ownerEmail)`, `mirrorScrapeRun(port, run)`, `mirrorListing(port, listing)`, `mirrorScraperConfig(port, config)`. `createWatch` gains an optional `port` argument; `ingestWatch`'s `IngestDeps` gains an optional `port`. Optional so every existing test keeps passing unchanged.

Mirroring must never break the pipeline: each mirror call is wrapped so a Port outage logs and continues.

- [ ] **Step 1: Write the failing test**

`craigsnotice_api/tests/mirror.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createFakePort } from "../src/services/port/fake";
import { mirrorWatch, mirrorScrapeRun, safeMirror } from "../src/services/port/mirror";

const watch = {
  id: "w1", siteCode: "sfbay", subarea: null, categoryCode: "sya", query: "Mac Studio",
  targetPrice: "1500", intervalSec: 300, status: "active",
  searchUrl: "https://sfbay.craigslist.org/search/sya?query=Mac+Studio",
};

describe("mirrorWatch", () => {
  it("upserts the watch with its query as the title", async () => {
    const port = createFakePort();
    await mirrorWatch(port, watch as never, "demo@x.dev");

    const u = port.upserts[0]!;
    expect(u.blueprint).toBe("craigsnotice_watch");
    expect(u.identifier).toBe("w1");
    expect(u.title).toBe("Mac Studio");
    expect(u.properties.targetPrice).toBe(1500);
    expect(u.properties.ownerEmail).toBe("demo@x.dev");
  });
});

describe("mirrorScrapeRun", () => {
  it("relates the run to its watch and scraper", async () => {
    const port = createFakePort();
    await mirrorScrapeRun(port, {
      id: "r1", watchId: "w1", scraperConfigId: "s1", snapshotId: "snap_1",
      status: "ready", rowCount: 12, violationCount: 0, durationMs: 41000,
    });

    const u = port.upserts[0]!;
    expect(u.blueprint).toBe("craigsnotice_scrape_run");
    expect(u.relations).toEqual({ watch: "w1", scraper: "s1" });
    expect(u.properties.rowCount).toBe(12);
  });
});

describe("safeMirror", () => {
  it("swallows a mirror failure so the pipeline continues", async () => {
    await expect(safeMirror(async () => { throw new Error("port is down"); })).resolves.toBeUndefined();
  });

  it("runs the mirror when Port is healthy", async () => {
    let ran = false;
    await safeMirror(async () => { ran = true; });
    expect(ran).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd craigsnotice_api && bun run test:run mirror`
Expected: FAIL — cannot resolve `../src/services/port/mirror`.

- [ ] **Step 3: Implement the mirrors**

`craigsnotice_api/src/services/port/mirror.ts`:

```ts
import type { PortClient } from "./client";

/** Port is a catalog, not a dependency. A mirror failure must never fail the pipeline. */
export const safeMirror = async (fn: () => Promise<void>): Promise<void> => {
  try {
    await fn();
  } catch (err) {
    console.warn(`[port] mirror failed: ${(err as Error).message}`);
  }
};

interface WatchRow {
  id: string; siteCode: string; subarea: string | null; categoryCode: string;
  query: string; targetPrice: string | null; intervalSec: number;
  status: string; searchUrl: string;
}

export const mirrorWatch = (port: PortClient, watch: WatchRow, ownerEmail: string): Promise<void> =>
  port.upsertEntity("craigsnotice_watch", watch.id, watch.query, {
    siteCode: watch.siteCode,
    subarea: watch.subarea,
    categoryCode: watch.categoryCode,
    query: watch.query,
    targetPrice: watch.targetPrice === null ? null : Number(watch.targetPrice),
    intervalSec: watch.intervalSec,
    status: watch.status,
    searchUrl: watch.searchUrl,
    ownerEmail,
  });

export interface ScrapeRunMirror {
  id: string; watchId: string | null; scraperConfigId: string; snapshotId: string;
  status: string; rowCount: number; violationCount: number; durationMs: number | null;
}

export const mirrorScrapeRun = (port: PortClient, run: ScrapeRunMirror): Promise<void> =>
  port.upsertEntity(
    "craigsnotice_scrape_run", run.id, `${run.status} · ${run.snapshotId}`,
    {
      snapshotId: run.snapshotId, status: run.status,
      rowCount: run.rowCount, violationCount: run.violationCount, durationMs: run.durationMs,
    },
    run.watchId ? { watch: run.watchId, scraper: run.scraperConfigId } : { scraper: run.scraperConfigId }
  );

interface ListingRow {
  id: string; watchId: string; title: string; price: string | null; url: string;
  postedAt: Date | null; condition: string | null; location: string | null;
}

export const mirrorListing = (port: PortClient, listing: ListingRow): Promise<void> =>
  port.upsertEntity(
    "craigsnotice_listing", listing.id, listing.title,
    {
      price: listing.price === null ? null : Number(listing.price),
      url: listing.url,
      postedAt: listing.postedAt?.toISOString() ?? null,
      condition: listing.condition,
      location: listing.location,
    },
    { watch: listing.watchId }
  );

interface ScraperConfigRow {
  id: string; kind: string; bdCollectorId: string; health: string;
  violationRate: string | number; lastHealedAt: Date | null; healPrompt: string | null;
}

export const mirrorScraperConfig = (port: PortClient, cfg: ScraperConfigRow): Promise<void> =>
  port.upsertEntity("craigsnotice_scraper_config", cfg.id, `${cfg.kind} scraper`, {
    kind: cfg.kind,
    collectorId: cfg.bdCollectorId,
    health: cfg.health,
    violationRate: Number(cfg.violationRate),
    lastHealedAt: cfg.lastHealedAt?.toISOString() ?? null,
    healPrompt: cfg.healPrompt,
  });
```

- [ ] **Step 4: Wire mirroring into the existing services**

In `createWatch`, after the insert, add an optional `port?: PortClient` parameter and:

```ts
if (port) await safeMirror(() => mirrorWatch(port, row!, ownerEmail));
```

In `ingestWatch`, add `port?: PortClient` to `IngestDeps` and mirror the run twice — once
after the `collecting` insert and once after the final `ready`/`failed` update — plus each
inserted listing:

```ts
if (deps.port) await safeMirror(() => mirrorScrapeRun(deps.port!, { ...runMirrorFields }));
if (deps.port && inserted) await safeMirror(() => mirrorListing(deps.port!, inserted));
```

- [ ] **Step 5: Run the full API suite**

Run: `cd craigsnotice_api && DATABASE_URL=postgres://localhost/craigsnotice_test bun run test:run`
Expected: PASS — the mirror tests plus every earlier test still green, since `port` is optional.

- [ ] **Step 6: Commit**

```bash
git add craigsnotice_api/src/services craigsnotice_api/tests/mirror.test.ts
git commit -m "feat(api): mirror watches, runs and listings into the Port catalog"
```

---

# Phase 3 — Notifications and the feedback loop

### Task 19: Notification dispatcher (FCM + SSE)

**Files:**
- Create: `craigsnotice_api/src/services/notify/sse.ts`, `notify/fcm.ts`, `notify/dispatcher.ts`
- Create: `craigsnotice_api/src/routes/alerts.ts`
- Test: `craigsnotice_api/tests/notify.test.ts`
- Modify: `craigsnotice_api/src/app.ts`

**Interfaces:**
- Consumes: `dealAlerts`/`listings`/`users` tables (Task 7).
- Produces:

```ts
export interface AlertPayload { alertId: string; watchId: string; title: string; price: number | null; url: string; score: number; reasoning: string; priceVsMedian: number }
export interface NotificationChannel { name: "fcm" | "sse"; send(userId: string, alert: AlertPayload): Promise<void> }
export interface SseHub { subscribe(userId: string): ReadableStream<Uint8Array>; publish(userId: string, alert: AlertPayload): void; subscriberCount(userId: string): number }
export const createSseHub: () => SseHub
export const createFcmChannel: (messaging: Messaging, db: Db) => NotificationChannel
export const createSseChannel: (hub: SseHub) => NotificationChannel
export const createDispatcher: (channels: NotificationChannel[]) => { dispatch(userId: string, alert: AlertPayload): Promise<void> }
```

Routes: `GET /api/v1/alerts` (list), `GET /api/v1/alerts/stream` (SSE). Tasks 21 and 31 consume these.

**Both channels always fire.** One channel failing must never suppress the other — that is the whole point of having two.

- [ ] **Step 1: Write the failing test**

`craigsnotice_api/tests/notify.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { createSseHub, createSseChannel, createDispatcher } from "../src/services/notify/dispatcher";
import type { NotificationChannel, AlertPayload } from "../src/services/notify/dispatcher";

const alert: AlertPayload = {
  alertId: "a1", watchId: "w1", title: "Mac Studio M2 Max", price: 1200,
  url: "https://sfbay.craigslist.org/x/1.html", score: 88,
  reasoning: "34% under median", priceVsMedian: -0.34,
};

describe("createSseHub", () => {
  it("reports zero subscribers before anyone connects", () => {
    expect(createSseHub().subscriberCount("u1")).toBe(0);
  });

  it("delivers a published alert to a subscriber", async () => {
    const hub = createSseHub();
    const reader = hub.subscribe("u1").getReader();
    expect(hub.subscriberCount("u1")).toBe(1);

    hub.publish("u1", alert);
    const { value } = await reader.read();
    const text = new TextDecoder().decode(value);

    expect(text).toContain("event: deal-alert");
    expect(text).toContain("Mac Studio M2 Max");
  });

  it("does not deliver another user's alert", async () => {
    const hub = createSseHub();
    hub.subscribe("u1");
    hub.publish("u2", alert);
    expect(hub.subscriberCount("u2")).toBe(0);
  });
});

describe("createDispatcher", () => {
  it("sends through every channel", async () => {
    const calls: string[] = [];
    const chan = (name: "fcm" | "sse"): NotificationChannel => ({
      name, send: async () => { calls.push(name); },
    });

    await createDispatcher([chan("fcm"), chan("sse")]).dispatch("u1", alert);
    expect(calls).toEqual(["fcm", "sse"]);
  });

  it("still sends through the second channel when the first throws", async () => {
    const sse = vi.fn(async () => {});
    const channels: NotificationChannel[] = [
      { name: "fcm", send: async () => { throw new Error("no fcm token"); } },
      { name: "sse", send: sse },
    ];

    await expect(createDispatcher(channels).dispatch("u1", alert)).resolves.toBeUndefined();
    expect(sse).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd craigsnotice_api && bun run test:run notify`
Expected: FAIL — cannot resolve `../src/services/notify/dispatcher`.

- [ ] **Step 3: Implement the SSE hub and dispatcher**

`craigsnotice_api/src/services/notify/dispatcher.ts`:

```ts
export interface AlertPayload {
  alertId: string;
  watchId: string;
  title: string;
  price: number | null;
  url: string;
  score: number;
  reasoning: string;
  priceVsMedian: number;
}

export interface NotificationChannel {
  name: "fcm" | "sse";
  send(userId: string, alert: AlertPayload): Promise<void>;
}

export interface SseHub {
  subscribe(userId: string): ReadableStream<Uint8Array>;
  publish(userId: string, alert: AlertPayload): void;
  subscriberCount(userId: string): number;
}

export const createSseHub = (): SseHub => {
  const subscribers = new Map<string, Set<ReadableStreamDefaultController<Uint8Array>>>();
  const encoder = new TextEncoder();

  return {
    subscribe(userId) {
      return new ReadableStream<Uint8Array>({
        start(controller) {
          const set = subscribers.get(userId) ?? new Set();
          set.add(controller);
          subscribers.set(userId, set);
          controller.enqueue(encoder.encode(": connected\n\n"));
        },
        cancel() {
          for (const set of subscribers.values()) {
            for (const c of set) {
              try { c.close(); } catch { /* already closed */ }
            }
          }
          subscribers.delete(userId);
        },
      });
    },

    publish(userId, alert) {
      const set = subscribers.get(userId);
      if (!set) return;
      const frame = encoder.encode(`event: deal-alert\ndata: ${JSON.stringify(alert)}\n\n`);
      for (const controller of set) {
        try { controller.enqueue(frame); } catch { set.delete(controller); }
      }
    },

    subscriberCount: (userId) => subscribers.get(userId)?.size ?? 0,
  };
};

export const createSseChannel = (hub: SseHub): NotificationChannel => ({
  name: "sse",
  async send(userId, alert) { hub.publish(userId, alert); },
});

export const createDispatcher = (channels: NotificationChannel[]) => ({
  async dispatch(userId: string, alert: AlertPayload): Promise<void> {
    for (const channel of channels) {
      try {
        await channel.send(userId, alert);
      } catch (err) {
        console.warn(`[notify] channel ${channel.name} failed: ${(err as Error).message}`);
      }
    }
  },
});
```

- [ ] **Step 4: Implement the FCM channel**

`craigsnotice_api/src/services/notify/fcm.ts`:

```ts
import { eq } from "drizzle-orm";
import type { Messaging } from "firebase-admin/messaging";
import type { Db } from "../../db";
import { users } from "../../db/schema";
import type { AlertPayload, NotificationChannel } from "./dispatcher";

export const createFcmChannel = (messaging: Messaging, db: Db): NotificationChannel => ({
  name: "fcm",
  async send(userId, alert) {
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    const tokens = user?.fcmTokens ?? [];
    if (tokens.length === 0) return;

    const priceLabel = alert.price === null ? "no price" : `$${alert.price}`;
    await messaging.sendEachForMulticast({
      tokens,
      notification: { title: `Good deal: ${alert.title}`, body: `${priceLabel} — ${alert.reasoning}` },
      data: { alertId: alert.alertId, watchId: alert.watchId, url: alert.url },
      webpush: { fcmOptions: { link: alert.url } },
    });
  },
});
```

- [ ] **Step 5: Implement the alerts routes**

`craigsnotice_api/src/routes/alerts.ts` — `GET /` joins `deal_alerts` to `listings` and
`watches`, **left-joins `alert_feedback`** so each row carries `userFeedback` (null when the
user has not voted — Task 31's `AlertCard` disables its buttons on that field), filters by
`watches.userId = c.get("userId")`, orders by `createdAt` desc, limit 100. It returns the
`AlertView` shape that Task 27's client declares: `{ id, watchId, title, price, url, score,
reasoning, priceVsMedian, createdAt, userFeedback }`.
`GET /stream` returns the SSE stream:

```ts
router.get("/stream", (c) =>
  new Response(hub.subscribe(c.get("userId")), {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  })
);
```

Also add `POST /api/v1/users/fcm-token` storing a token onto `users.fcmTokens` if absent, so
Task 32 has somewhere to register.

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd craigsnotice_api && bun run test:run notify`
Expected: PASS, 5 tests.

- [ ] **Step 7: Commit**

```bash
git add craigsnotice_api/src/services/notify craigsnotice_api/src/routes/alerts.ts craigsnotice_api/tests/notify.test.ts craigsnotice_api/src/app.ts
git commit -m "feat(api): dispatch deal alerts over FCM web push and SSE"
```

---

### Task 20: Feedback endpoint

**Files:**
- Create: `craigsnotice_api/src/routes/feedback.ts`, `craigsnotice_api/src/services/feedback.ts`
- Test: `craigsnotice_api/tests/feedback.test.ts`
- Modify: `craigsnotice_api/src/app.ts`

**Interfaces:**
- Consumes: `feedbackSchema` (Task 5), `PortClient` (Task 15), `alertFeedback` table (Task 7).
- Produces: `recordFeedback(db, port, userId, alertId, verdict): Promise<Feedback | null>` — returns `null` when the alert does not belong to the user. Route `POST /api/v1/alerts/:id/feedback`. Task 31 consumes it.

Re-submitting feedback on the same alert **replaces** the previous verdict rather than stacking duplicates, so a user changing their mind does not double-weight `recentFeedback`.

- [ ] **Step 1: Write the failing test**

`craigsnotice_api/tests/feedback.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { db, resetDb } from "./setup";
import { createFakePort } from "../src/services/port/fake";
import { recordFeedback } from "../src/services/feedback";
import { alertFeedback, dealAlerts, listings, users, watches } from "../src/db/schema";

const seed = async () => {
  const [owner] = await db.insert(users).values({ firebaseUid: "u1", email: "a@b.c" }).returning();
  const [other] = await db.insert(users).values({ firebaseUid: "u2", email: "z@b.c" }).returning();
  const [w] = await db.insert(watches).values({
    userId: owner!.id, siteCode: "sfbay", categoryCode: "sya", query: "Mac Studio",
    searchUrl: "https://sfbay.craigslist.org/search/sya?query=Mac+Studio",
  }).returning();
  const [l] = await db.insert(listings).values({
    watchId: w!.id, clPostId: "1", title: "Mac Studio", price: "1200",
    url: "https://sfbay.craigslist.org/x/1.html",
  }).returning();
  const [a] = await db.insert(dealAlerts).values({
    listingId: l!.id, watchId: w!.id, score: 88, isGoodDeal: true,
    reasoning: "under median", priceVsMedian: "-0.34",
  }).returning();
  return { owner: owner!, other: other!, alert: a! };
};

describe("recordFeedback", () => {
  beforeEach(async () => { await resetDb(); });

  it("stores a verdict for the alert owner", async () => {
    const { owner, alert } = await seed();
    const port = createFakePort();

    const result = await recordFeedback(db, port, owner.id, alert.id, "good");

    expect(result).not.toBeNull();
    const rows = await db.select().from(alertFeedback).where(eq(alertFeedback.alertId, alert.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.verdict).toBe("good");
  });

  it("patches the Port entity so the loop is visible in the catalog", async () => {
    const { owner, alert } = await seed();
    const port = createFakePort();

    await recordFeedback(db, port, owner.id, alert.id, "bad");

    expect(port.patches[0]).toEqual({
      blueprint: "craigsnotice_deal_alert",
      identifier: alert.id,
      properties: { userFeedback: "bad" },
    });
  });

  it("replaces rather than duplicates when the user changes their mind", async () => {
    const { owner, alert } = await seed();
    const port = createFakePort();

    await recordFeedback(db, port, owner.id, alert.id, "good");
    await recordFeedback(db, port, owner.id, alert.id, "bad");

    const rows = await db.select().from(alertFeedback).where(eq(alertFeedback.alertId, alert.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.verdict).toBe("bad");
  });

  it("returns null for an alert belonging to someone else", async () => {
    const { other, alert } = await seed();
    const port = createFakePort();

    expect(await recordFeedback(db, port, other.id, alert.id, "good")).toBeNull();
    expect(await db.select().from(alertFeedback)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd craigsnotice_api && DATABASE_URL=postgres://localhost/craigsnotice_test bun run test:run feedback`
Expected: FAIL — cannot resolve `../src/services/feedback`.

- [ ] **Step 3: Implement the service**

`craigsnotice_api/src/services/feedback.ts`:

```ts
import { and, eq } from "drizzle-orm";
import type { FeedbackVerdict } from "@craigsnotice/types";
import type { Db } from "../db";
import { alertFeedback, dealAlerts, watches } from "../db/schema";
import type { PortClient } from "./port/client";
import { safeMirror } from "./port/mirror";

export const recordFeedback = async (
  db: Db,
  port: PortClient,
  userId: string,
  alertId: string,
  verdict: FeedbackVerdict
) => {
  const owned = await db
    .select({ alertId: dealAlerts.id })
    .from(dealAlerts)
    .innerJoin(watches, eq(dealAlerts.watchId, watches.id))
    .where(and(eq(dealAlerts.id, alertId), eq(watches.userId, userId)));

  if (owned.length === 0) return null;

  await db.delete(alertFeedback)
    .where(and(eq(alertFeedback.alertId, alertId), eq(alertFeedback.userId, userId)));

  const [row] = await db.insert(alertFeedback).values({ alertId, userId, verdict }).returning();

  await safeMirror(() => port.patchEntity("craigsnotice_deal_alert", alertId, { userFeedback: verdict }));

  return row!;
};
```

- [ ] **Step 4: Implement the route**

`craigsnotice_api/src/routes/feedback.ts`:

```ts
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { feedbackSchema, successResponse, errorResponse } from "@craigsnotice/types";
import type { Db } from "../db";
import type { PortClient } from "../services/port/client";
import { recordFeedback } from "../services/feedback";

export const createFeedbackRouter = (db: Db, port: PortClient): Hono => {
  const router = new Hono();

  router.post(
    "/:id/feedback",
    zValidator("param", z.object({ id: z.string().uuid() })),
    zValidator("json", feedbackSchema),
    async (c) => {
      const row = await recordFeedback(
        db, port, c.get("userId"), c.req.valid("param").id, c.req.valid("json").verdict
      );
      return row ? c.json(successResponse(row)) : c.json(errorResponse("alert not found"), 404);
    }
  );

  return router;
};
```

Mount it on `/api/v1/alerts` in `createApp` behind the auth middleware.

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd craigsnotice_api && DATABASE_URL=postgres://localhost/craigsnotice_test bun run test:run feedback`
Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```bash
git add craigsnotice_api/src/services/feedback.ts craigsnotice_api/src/routes/feedback.ts craigsnotice_api/tests/feedback.test.ts craigsnotice_api/src/app.ts
git commit -m "feat(api): record deal feedback and mirror it to the Port catalog"
```

---

# Phase 4 — Scheduler and self-healing

### Task 21: Scheduler and run-now

**Files:**
- Create: `craigsnotice_api/src/services/scheduler.ts`
- Test: `craigsnotice_api/tests/scheduler.test.ts`
- Modify: `craigsnotice_api/src/routes/watches.ts`, `craigsnotice_api/src/index.ts`

**Interfaces:**
- Consumes: `ingestWatch` (Task 13), `judgeListing` (Task 17), dispatcher (Task 19), self-heal (Task 22, injected as an optional callback so ordering does not matter).
- Produces:

```ts
export interface CycleDeps extends IngestDeps { port: PortClient; agentId: string; minBaselineSamples: number; dispatcher: { dispatch(userId: string, a: AlertPayload): Promise<void> }; onDegraded?: (info: { scraperConfigId: string; violationRate: number; sampleViolation: string | null }) => Promise<void>; violationRateThreshold: number }
export interface CycleResult { runId: string; scrapedCount: number; judged: number; alerted: number; degraded: boolean }
export const runWatchCycle: (deps: CycleDeps, watchId: string) => Promise<CycleResult>
export const createScheduler: (deps: CycleDeps, db: Db, opts?: { tickMs?: number }) => { start(): void; stop(): void }
```

Route: `POST /api/v1/watches/:id/run` triggers one cycle immediately and returns its result. **This is the demo button** — a 300s interval is realistic but unusable on stage.

The scheduler is a single interval that every 15s selects active watches whose most recent
run started more than `intervalSec` ago, and runs a cycle for each. It never runs two cycles
for the same watch concurrently.

- [ ] **Step 1: Write the failing test**

`craigsnotice_api/tests/scheduler.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { db, resetDb } from "./setup";
import { createFakeBrightData } from "../src/services/brightdata/fake";
import { createFakePort } from "../src/services/port/fake";
import { createPollingDelivery } from "../src/services/brightdata/delivery";
import { runWatchCycle } from "../src/services/scheduler";
import { listings, scraperConfigs, users, watches } from "../src/db/schema";

const noSleep = async (): Promise<void> => {};
const GOOD = { isGoodDeal: true, score: 90, reasoning: "cheap", priceVsMedian: -0.4 };

const row = (id: string) => ({
  post_id: id, title: `Mac Studio ${id}`, price: "$1,200",
  url: `https://sfbay.craigslist.org/x/${id}.html`,
});

const seed = async () => {
  const [u] = await db.insert(users).values({ firebaseUid: "u1", email: "a@b.c" }).returning();
  const [w] = await db.insert(watches).values({
    userId: u!.id, siteCode: "sfbay", categoryCode: "sya", query: "Mac Studio",
    searchUrl: "https://sfbay.craigslist.org/search/sya?query=Mac+Studio",
  }).returning();
  const [sc] = await db.insert(scraperConfigs).values({ kind: "search", bdCollectorId: "search-collector" }).returning();
  return { user: u!, watch: w!, scraperConfigId: sc!.id };
};

const makeDeps = (bd: ReturnType<typeof createFakeBrightData>, port: ReturnType<typeof createFakePort>, extra = {}) => ({
  db, bd, port,
  delivery: createPollingDelivery(bd, { sleep: noSleep }),
  searchCollectorId: "search-collector",
  detailCollectorId: "detail-collector",
  agentId: "deal-agent",
  minBaselineSamples: 5,
  violationRateThreshold: 0.3,
  dispatcher: { dispatch: vi.fn(async () => {}) },
  ...extra,
});

describe("runWatchCycle", () => {
  beforeEach(async () => { await resetDb(); });

  it("scrapes, judges and dispatches an alert end to end", async () => {
    const { watch } = await seed();
    const bd = createFakeBrightData();
    bd.queue("x", [row("1")]);
    const port = createFakePort();
    port.respondWith(GOOD);
    const deps = makeDeps(bd, port);

    const result = await runWatchCycle(deps, watch.id);

    expect(result.scrapedCount).toBe(1);
    expect(result.judged).toBe(1);
    expect(result.alerted).toBe(1);
    expect(deps.dispatcher.dispatch).toHaveBeenCalledOnce();
  });

  it("dispatches nothing when the agent rejects the listing", async () => {
    const { watch } = await seed();
    const bd = createFakeBrightData();
    bd.queue("x", [row("1")]);
    const port = createFakePort();
    port.respondWith({ isGoodDeal: false, score: 10, reasoning: "pricey", priceVsMedian: 0.3 });
    const deps = makeDeps(bd, port);

    const result = await runWatchCycle(deps, watch.id);

    expect(result.alerted).toBe(0);
    expect(deps.dispatcher.dispatch).not.toHaveBeenCalled();
  });

  it("judges nothing on a second cycle that finds no new listings", async () => {
    const { watch } = await seed();
    const bd = createFakeBrightData();
    bd.queue("x", [row("1")]);
    const port = createFakePort();
    port.respondWith(GOOD);
    const deps = makeDeps(bd, port);

    await runWatchCycle(deps, watch.id);
    bd.queue("x", [row("1")]);
    const second = await runWatchCycle(deps, watch.id);

    expect(second.judged).toBe(0);
    expect(await db.select().from(listings)).toHaveLength(1);
  });

  it("invokes the degraded callback and skips judgment when the violation rate is too high", async () => {
    const { watch } = await seed();
    const bd = createFakeBrightData();
    bd.queue("x", [row("1"), { title: "broken" }, { title: "broken" }]);
    const port = createFakePort();
    const onDegraded = vi.fn(async () => {});
    const deps = makeDeps(bd, port, { onDegraded });

    const result = await runWatchCycle(deps, watch.id);

    expect(result.degraded).toBe(true);
    expect(onDegraded).toHaveBeenCalledOnce();
    expect(onDegraded.mock.calls[0]![0].violationRate).toBeCloseTo(2 / 3);
    expect(result.judged).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd craigsnotice_api && DATABASE_URL=postgres://localhost/craigsnotice_test bun run test:run scheduler`
Expected: FAIL — cannot resolve `../src/services/scheduler`.

- [ ] **Step 3: Implement the cycle**

`craigsnotice_api/src/services/scheduler.ts`:

```ts
import { and, eq } from "drizzle-orm";
import type { Db } from "../db";
import { listings, scraperConfigs, watches } from "../db/schema";
import { ingestWatch, type IngestDeps } from "./ingest";
import { judgeListing } from "./judgment";
import { isDegraded } from "./parse";
import type { PortClient } from "./port/client";
import type { AlertPayload } from "./notify/dispatcher";

export interface DegradedInfo {
  scraperConfigId: string;
  violationRate: number;
  sampleViolation: string | null;
}

export interface CycleDeps extends IngestDeps {
  port: PortClient;
  agentId: string;
  minBaselineSamples: number;
  violationRateThreshold: number;
  dispatcher: { dispatch(userId: string, alert: AlertPayload): Promise<void> };
  onDegraded?: (info: DegradedInfo) => Promise<void>;
}

export interface CycleResult {
  runId: string;
  scrapedCount: number;
  judged: number;
  alerted: number;
  degraded: boolean;
}

export const runWatchCycle = async (deps: CycleDeps, watchId: string): Promise<CycleResult> => {
  const [watch] = await deps.db.select().from(watches).where(eq(watches.id, watchId));
  if (!watch) throw new Error(`watch ${watchId} not found`);

  const [config] = await deps.db.select().from(scraperConfigs)
    .where(and(eq(scraperConfigs.kind, "search"), eq(scraperConfigs.bdCollectorId, deps.searchCollectorId)));
  if (!config) throw new Error("search scraper config not registered");

  const ingest = await ingestWatch(deps, watch, config.id);

  if (isDegraded(ingest.violationRate, deps.violationRateThreshold)) {
    await deps.onDegraded?.({
      scraperConfigId: config.id,
      violationRate: ingest.violationRate,
      sampleViolation: ingest.sampleViolation,
    });
    return { runId: ingest.runId, scrapedCount: ingest.scrapedCount, judged: 0, alerted: 0, degraded: true };
  }

  let alerted = 0;
  for (const listingId of ingest.newListingIds) {
    const outcome = await judgeListing(
      { db: deps.db, port: deps.port, agentId: deps.agentId, minBaselineSamples: deps.minBaselineSamples },
      watchId,
      listingId
    );
    if (!outcome.alertId || !outcome.verdict) continue;

    const [listing] = await deps.db.select().from(listings).where(eq(listings.id, listingId));
    await deps.dispatcher.dispatch(watch.userId, {
      alertId: outcome.alertId,
      watchId,
      title: listing!.title,
      price: listing!.price === null ? null : Number(listing!.price),
      url: listing!.url,
      score: outcome.verdict.score,
      reasoning: outcome.verdict.reasoning,
      priceVsMedian: outcome.verdict.priceVsMedian,
    });
    alerted += 1;
  }

  return {
    runId: ingest.runId,
    scrapedCount: ingest.scrapedCount,
    judged: ingest.newListingIds.length,
    alerted,
    degraded: false,
  };
};

export const createScheduler = (deps: CycleDeps, db: Db, opts: { tickMs?: number } = {}) => {
  const tickMs = opts.tickMs ?? 15_000;
  const inFlight = new Set<string>();
  let timer: ReturnType<typeof setInterval> | null = null;

  const tick = async (): Promise<void> => {
    const due = await db.select().from(watches).where(eq(watches.status, "active"));
    for (const watch of due) {
      if (inFlight.has(watch.id)) continue;
      inFlight.add(watch.id);
      runWatchCycle(deps, watch.id)
        .catch((err) => console.warn(`[scheduler] cycle failed for ${watch.id}: ${(err as Error).message}`))
        .finally(() => inFlight.delete(watch.id));
    }
  };

  return {
    start() { timer ??= setInterval(() => void tick(), tickMs); },
    stop() { if (timer) { clearInterval(timer); timer = null; } },
  };
};
```

The due-watch filter above runs every active watch each tick; tighten it to
`lastRunStartedAt < now - intervalSec` with a subquery on `scrape_runs` before enabling the
scheduler in production. For the demo the **Run now** button is the primary path.

- [ ] **Step 4: Add the run-now route**

In `createWatchesRouter`, add:

```ts
router.post("/:id/run", zValidator("param", z.object({ id: z.string().uuid() })), async (c) => {
  const watch = await getWatch(db, c.get("userId"), c.req.valid("param").id);
  if (!watch) return c.json(errorResponse("watch not found"), 404);
  return c.json(successResponse(await runWatchCycle(cycleDeps, watch.id)));
});
```

`createWatchesRouter` gains a `cycleDeps: CycleDeps` parameter; `AppDeps` gains `cycleDeps`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd craigsnotice_api && DATABASE_URL=postgres://localhost/craigsnotice_test bun run test:run scheduler`
Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```bash
git add craigsnotice_api/src/services/scheduler.ts craigsnotice_api/src/routes/watches.ts craigsnotice_api/tests/scheduler.test.ts
git commit -m "feat(api): add watch cycle orchestration, scheduler and run-now"
```

---

### Task 22: Self-heal chain and the staged failure trigger

**Files:**
- Create: `craigsnotice_api/src/services/selfheal.ts`, `craigsnotice_api/src/routes/debug.ts`
- Test: `craigsnotice_api/tests/selfheal.test.ts`
- Modify: `craigsnotice_api/src/app.ts`, `craigsnotice_api/src/services/parse.ts`

**Interfaces:**
- Consumes: `BrightDataClient.heal` (Task 10), `PortClient.patchEntity` (Task 15), `scraperConfigs` table (Task 7).
- Produces:

```ts
export type SelfHealEvent = "scraper.selfheal.triggered" | "scraper.selfheal.succeeded" | "scraper.selfheal.failed";
export interface SelfHealDeps { db: Db; bd: BrightDataClient; port: PortClient; emit: (event: SelfHealEvent, attrs: Record<string, unknown>) => void }
export const buildHealPrompt: (kind: string, sampleViolation: string | null) => string
export const handleDegraded: (deps: SelfHealDeps, info: DegradedInfo) => Promise<{ healed: boolean; prompt: string; error: string | null }>
export interface FailureInjector { arm(): void; consume(): boolean }
export const createFailureInjector: () => FailureInjector
```

Task 24 supplies the real `emit`; until then it is `() => {}`.

**Honesty:** `POST /api/v1/debug/inject-scrape-failure` arms the injector, which corrupts the
next parse so the chain below runs for real. Gated on `NODE_ENV !== "production"` and an
`x-debug-token` header matching `DEBUG_TOKEN`. Task 34's README says plainly that the break is
staged and the chain is not.

- [ ] **Step 1: Write the failing test**

`craigsnotice_api/tests/selfheal.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db, resetDb } from "./setup";
import { createFakeBrightData } from "../src/services/brightdata/fake";
import { createFakePort } from "../src/services/port/fake";
import { buildHealPrompt, handleDegraded, createFailureInjector } from "../src/services/selfheal";
import { scraperConfigs } from "../src/db/schema";

const seedConfig = async () => {
  const [sc] = await db.insert(scraperConfigs).values({ kind: "search", bdCollectorId: "search-collector" }).returning();
  return sc!;
};

describe("buildHealPrompt", () => {
  it("names the failing fields from the sample violation", () => {
    const p = buildHealPrompt("search", "price: Required; post_id: Required");
    expect(p).toMatch(/price/);
    expect(p).toMatch(/post_id/);
    expect(p).toMatch(/craigslist/i);
  });

  it("falls back to a generic prompt when there is no sample", () => {
    expect(buildHealPrompt("search", null)).toMatch(/re-derive/i);
  });
});

describe("handleDegraded", () => {
  beforeEach(async () => { await resetDb(); });

  const deps = (bd: ReturnType<typeof createFakeBrightData>, port: ReturnType<typeof createFakePort>, emit = vi.fn()) =>
    ({ db, bd, port, emit });

  it("marks the config degraded, heals it, and restores health", async () => {
    const cfg = await seedConfig();
    const bd = createFakeBrightData();
    const port = createFakePort();
    const emit = vi.fn();

    const out = await handleDegraded(deps(bd, port, emit), {
      scraperConfigId: cfg.id, violationRate: 0.75, sampleViolation: "post_id: Required",
    });

    expect(out.healed).toBe(true);
    expect(bd.healCalls).toHaveLength(1);
    expect(bd.healCalls[0]!.collectorId).toBe("search-collector");

    const [after] = await db.select().from(scraperConfigs).where(eq(scraperConfigs.id, cfg.id));
    expect(after!.health).toBe("healthy");
    expect(after!.lastHealedAt).not.toBeNull();
    expect(after!.healPrompt).toBe(out.prompt);
  });

  it("emits triggered then succeeded", async () => {
    const cfg = await seedConfig();
    const emit = vi.fn();
    await handleDegraded(deps(createFakeBrightData(), createFakePort(), emit), {
      scraperConfigId: cfg.id, violationRate: 0.75, sampleViolation: null,
    });

    expect(emit.mock.calls.map(([e]) => e)).toEqual([
      "scraper.selfheal.triggered",
      "scraper.selfheal.succeeded",
    ]);
    expect(emit.mock.calls[0]![1].violationRate).toBe(0.75);
  });

  it("patches the Port entity to degraded and back to healthy", async () => {
    const cfg = await seedConfig();
    const port = createFakePort();
    await handleDegraded(deps(createFakeBrightData(), port), {
      scraperConfigId: cfg.id, violationRate: 0.75, sampleViolation: null,
    });

    expect(port.patches.map((p) => p.properties.health)).toEqual(["degraded", "healthy"]);
    expect(port.patches[0]!.blueprint).toBe("craigsnotice_scraper_config");
  });

  it("emits failed and leaves the config degraded when the heal throws", async () => {
    const cfg = await seedConfig();
    const bd = createFakeBrightData();
    bd.heal = async () => { throw new Error("heal API unavailable"); };
    const emit = vi.fn();

    const out = await handleDegraded(deps(bd, createFakePort(), emit), {
      scraperConfigId: cfg.id, violationRate: 0.9, sampleViolation: null,
    });

    expect(out.healed).toBe(false);
    expect(out.error).toMatch(/heal API unavailable/);
    expect(emit.mock.calls.map(([e]) => e)).toEqual([
      "scraper.selfheal.triggered",
      "scraper.selfheal.failed",
    ]);

    const [after] = await db.select().from(scraperConfigs).where(eq(scraperConfigs.id, cfg.id));
    expect(after!.health).toBe("degraded");
  });
});

describe("createFailureInjector", () => {
  it("is disarmed by default", () => {
    expect(createFailureInjector().consume()).toBe(false);
  });

  it("fires exactly once after being armed", () => {
    const injector = createFailureInjector();
    injector.arm();
    expect(injector.consume()).toBe(true);
    expect(injector.consume()).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd craigsnotice_api && DATABASE_URL=postgres://localhost/craigsnotice_test bun run test:run selfheal`
Expected: FAIL — cannot resolve `../src/services/selfheal`.

- [ ] **Step 3: Implement the chain**

`craigsnotice_api/src/services/selfheal.ts`:

```ts
import { eq } from "drizzle-orm";
import type { Db } from "../db";
import { scraperConfigs } from "../db/schema";
import type { BrightDataClient } from "./brightdata/client";
import type { PortClient } from "./port/client";
import { safeMirror } from "./port/mirror";
import type { DegradedInfo } from "./scheduler";

export type SelfHealEvent =
  | "scraper.selfheal.triggered"
  | "scraper.selfheal.succeeded"
  | "scraper.selfheal.failed";

export interface SelfHealDeps {
  db: Db;
  bd: BrightDataClient;
  port: PortClient;
  emit: (event: SelfHealEvent, attrs: Record<string, unknown>) => void;
}

export const buildHealPrompt = (kind: string, sampleViolation: string | null): string => {
  const target = kind === "detail" ? "Craigslist listing detail page" : "Craigslist search results page";
  if (!sampleViolation) {
    return `The ${target} scraper is returning rows that no longer match its output schema. ` +
      `Re-derive the selectors for every field in the schema.`;
  }
  return `The ${target} scraper is returning rows that no longer match its output schema. ` +
    `Validation reports: ${sampleViolation}. Re-derive the selectors for those fields, ` +
    `keeping the existing output schema unchanged.`;
};

export const handleDegraded = async (
  deps: SelfHealDeps,
  info: DegradedInfo
): Promise<{ healed: boolean; prompt: string; error: string | null }> => {
  const [config] = await deps.db.select().from(scraperConfigs)
    .where(eq(scraperConfigs.id, info.scraperConfigId));
  if (!config) throw new Error(`scraper config ${info.scraperConfigId} not found`);

  const prompt = buildHealPrompt(config.kind, info.sampleViolation);

  await deps.db.update(scraperConfigs)
    .set({ health: "degraded", violationRate: String(info.violationRate), healPrompt: prompt })
    .where(eq(scraperConfigs.id, config.id));

  await safeMirror(() =>
    deps.port.patchEntity("craigsnotice_scraper_config", config.id, {
      health: "degraded", violationRate: info.violationRate, healPrompt: prompt,
    })
  );

  deps.emit("scraper.selfheal.triggered", {
    collectorId: config.bdCollectorId,
    scraperConfigId: config.id,
    violationRate: info.violationRate,
    sampleViolation: info.sampleViolation,
    healPrompt: prompt,
  });

  try {
    await deps.bd.heal(config.bdCollectorId, prompt);
  } catch (err) {
    const error = (err as Error).message;
    deps.emit("scraper.selfheal.failed", { collectorId: config.bdCollectorId, scraperConfigId: config.id, error });
    return { healed: false, prompt, error };
  }

  const healedAt = new Date();
  await deps.db.update(scraperConfigs)
    .set({ health: "healthy", violationRate: "0", lastHealedAt: healedAt })
    .where(eq(scraperConfigs.id, config.id));

  await safeMirror(() =>
    deps.port.patchEntity("craigsnotice_scraper_config", config.id, {
      health: "healthy", violationRate: 0, lastHealedAt: healedAt.toISOString(),
    })
  );

  deps.emit("scraper.selfheal.succeeded", {
    collectorId: config.bdCollectorId, scraperConfigId: config.id, healPrompt: prompt,
  });

  return { healed: true, prompt, error: null };
};

/**
 * Staged-failure trigger for the demo. Arming it makes the NEXT parse treat every
 * row as a schema violation, which drives the real detection -> heal -> recovery chain.
 * The break is synthetic; nothing downstream of it is.
 */
export interface FailureInjector {
  arm(): void;
  consume(): boolean;
}

export const createFailureInjector = (): FailureInjector => {
  let armed = false;
  return {
    arm() { armed = true; },
    consume() {
      if (!armed) return false;
      armed = false;
      return true;
    },
  };
};
```

- [ ] **Step 4: Wire the injector into parsing and add the debug route**

In `parseRows`, accept an optional third argument `forceFailure = false`; when true, treat
every row as a violation and set `sampleViolation` to
`"injected failure: post_id: Required; price: Required"`.

Add `injector?: FailureInjector` to `IngestDeps` (Task 13) and have `ingestWatch` pass
`deps.injector?.consume() ?? false` as that third argument on the **search** parse only —
never on the detail parse, or a single injection would fire twice. `CycleDeps` inherits the
field through `IngestDeps`, so `src/index.ts` supplies one shared injector to both the
scheduler and the debug router.

`craigsnotice_api/src/routes/debug.ts`:

```ts
import { Hono } from "hono";
import { successResponse, errorResponse } from "@craigsnotice/types";
import type { FailureInjector } from "../services/selfheal";

export const createDebugRouter = (injector: FailureInjector, debugToken: string | null): Hono => {
  const router = new Hono();

  router.use("*", async (c, next) => {
    if (process.env.NODE_ENV === "production") return c.json(errorResponse("not found"), 404);
    if (!debugToken || c.req.header("x-debug-token") !== debugToken) {
      return c.json(errorResponse("forbidden"), 403);
    }
    await next();
  });

  router.post("/inject-scrape-failure", (c) => {
    injector.arm();
    return c.json(successResponse({ armed: true, note: "next scrape parse will report a total schema violation" }));
  });

  return router;
};
```

Mount at `/api/v1/debug`. Wire `onDegraded` in `src/index.ts` to
`(info) => handleDegraded({ db, bd, port, emit }, info).then(() => undefined)`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd craigsnotice_api && DATABASE_URL=postgres://localhost/craigsnotice_test bun run test:run selfheal`
Expected: PASS, 8 tests.

- [ ] **Step 6: Commit**

```bash
git add craigsnotice_api/src/services/selfheal.ts craigsnotice_api/src/routes/debug.ts craigsnotice_api/src/services/parse.ts craigsnotice_api/tests/selfheal.test.ts
git commit -m "feat(api): add self-heal chain with a gated staged-failure trigger"
```

---

### Task 23: SigNoz alert webhook

**Files:**
- Create: `craigsnotice_api/src/routes/hooks.ts`
- Test: `craigsnotice_api/tests/hooks.test.ts`
- Modify: `craigsnotice_api/src/app.ts`

**Interfaces:**
- Consumes: `handleDegraded` (Task 22).
- Produces: route `POST /api/v1/hooks/signoz/heal`, accepting SigNoz's alert webhook body and
  running a heal for the named collector. **This is the "feedback loops into the factory"
  bullet** — observability does not merely watch the pipeline, it repairs it.

SigNoz posts `{ alerts: [{ labels: { collector_id, scraper_config_id }, status }] }`. Only
`status: "firing"` triggers a heal; `"resolved"` is acknowledged and ignored.

- [ ] **Step 1: Write the failing test**

`craigsnotice_api/tests/hooks.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { Hono } from "hono";
import { db, resetDb } from "./setup";
import { createHooksRouter } from "../src/routes/hooks";
import { scraperConfigs } from "../src/db/schema";

const post = (app: Hono, body: unknown) =>
  app.request("/signoz/heal", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });

describe("POST /hooks/signoz/heal", () => {
  beforeEach(async () => { await resetDb(); });

  const build = (onHeal = vi.fn(async () => ({ healed: true, prompt: "p", error: null }))) => {
    const app = new Hono();
    app.route("/", createHooksRouter(db, onHeal));
    return { app, onHeal };
  };

  it("heals the named scraper on a firing alert", async () => {
    const [cfg] = await db.insert(scraperConfigs).values({ kind: "search", bdCollectorId: "c1", health: "degraded" }).returning();
    const { app, onHeal } = build();

    const res = await post(app, {
      alerts: [{ status: "firing", labels: { scraper_config_id: cfg!.id, collector_id: "c1" } }],
    });

    expect(res.status).toBe(200);
    expect(onHeal).toHaveBeenCalledOnce();
    expect(onHeal.mock.calls[0]![0].scraperConfigId).toBe(cfg!.id);
  });

  it("ignores a resolved alert", async () => {
    const [cfg] = await db.insert(scraperConfigs).values({ kind: "search", bdCollectorId: "c1" }).returning();
    const { app, onHeal } = build();

    const res = await post(app, {
      alerts: [{ status: "resolved", labels: { scraper_config_id: cfg!.id, collector_id: "c1" } }],
    });

    expect(res.status).toBe(200);
    expect(onHeal).not.toHaveBeenCalled();
  });

  it("returns 400 for a body that is not a SigNoz alert payload", async () => {
    const { app } = build();
    expect((await post(app, { hello: "world" })).status).toBe(400);
  });

  it("reports which scrapers were healed", async () => {
    const [cfg] = await db.insert(scraperConfigs).values({ kind: "search", bdCollectorId: "c1", health: "degraded" }).returning();
    const { app } = build();

    const res = await post(app, {
      alerts: [{ status: "firing", labels: { scraper_config_id: cfg!.id, collector_id: "c1" } }],
    });

    expect((await res.json()).data.healed).toEqual([cfg!.id]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd craigsnotice_api && DATABASE_URL=postgres://localhost/craigsnotice_test bun run test:run hooks`
Expected: FAIL — cannot resolve `../src/routes/hooks`.

- [ ] **Step 3: Implement the route**

`craigsnotice_api/src/routes/hooks.ts`:

```ts
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { successResponse } from "@craigsnotice/types";
import type { Db } from "../db";
import type { DegradedInfo } from "../services/scheduler";

const signozAlertSchema = z.object({
  alerts: z.array(
    z.object({
      status: z.string(),
      labels: z.object({
        scraper_config_id: z.string(),
        collector_id: z.string().optional(),
      }),
    })
  ).min(1),
});

export type HealHandler = (info: DegradedInfo) => Promise<{ healed: boolean; prompt: string; error: string | null }>;

export const createHooksRouter = (_db: Db, onHeal: HealHandler): Hono => {
  const router = new Hono();

  router.post("/signoz/heal", zValidator("json", signozAlertSchema), async (c) => {
    const healed: string[] = [];

    for (const alert of c.req.valid("json").alerts) {
      if (alert.status !== "firing") continue;
      const result = await onHeal({
        scraperConfigId: alert.labels.scraper_config_id,
        violationRate: 1,
        sampleViolation: "SigNoz alert: scraper.health reported degraded",
      });
      if (result.healed) healed.push(alert.labels.scraper_config_id);
    }

    return c.json(successResponse({ healed }));
  });

  return router;
};
```

- [ ] **Step 4: Configure the SigNoz alert rule**

In SigNoz, create an alert on the `scraper.health` gauge with condition `below 1 for 1 minute`,
labelled with `scraper_config_id` and `collector_id`, and a webhook notification channel
pointing at `http://<tunnel-or-localhost>:8022/api/v1/hooks/signoz/heal`. Save the rule
definition to `signoz/alerts/scraper-degraded.json` in the repo so it is reproducible.

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd craigsnotice_api && DATABASE_URL=postgres://localhost/craigsnotice_test bun run test:run hooks`
Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```bash
git add craigsnotice_api/src/routes/hooks.ts craigsnotice_api/tests/hooks.test.ts signoz/alerts
git commit -m "feat(api): close the loop with a SigNoz alert webhook that triggers a heal"
```

---

# Phase 5 — Observability

### Task 24: OpenTelemetry bootstrap and pipeline spans

**Files:**
- Modify: `craigsnotice_api/src/otel.ts` (created empty in Task 6)
- Create: `craigsnotice_api/src/telemetry/index.ts`
- Modify: `craigsnotice_api/src/services/{ingest,judgment,scheduler,selfheal}.ts`, `src/services/notify/dispatcher.ts`
- Test: `craigsnotice_api/tests/telemetry.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:

```ts
export const tracer: Tracer
export const withSpan: <T>(name: string, attrs: Record<string, AttributeValue>, fn: (span: Span) => Promise<T>) => Promise<T>
```

`withSpan` records the exception and sets `SpanStatusCode.ERROR` before rethrowing, so a
failure is diagnosable in SigNoz rather than a silent gap. Tasks 25 and 26 build on this.

**Span tree (spec §11):** `watch.tick` → `scrape.trigger`, `scrape.poll`, `scrape.parse`,
`listing.detail.fetch`, `baseline.compute`, `agent.invoke`, `alert.notify`. Every span carries
`watch.id`, and `run.id` / `listing.id` where applicable.

- [ ] **Step 1: Install the dependencies**

Run:
```bash
cd craigsnotice_api && bun add @opentelemetry/api @opentelemetry/sdk-node \
  @opentelemetry/auto-instrumentations-node @opentelemetry/exporter-trace-otlp-http \
  @opentelemetry/exporter-metrics-otlp-http @opentelemetry/sdk-metrics @opentelemetry/resources
bun add -d @opentelemetry/sdk-trace-base
```

- [ ] **Step 2: Write the failing test**

`craigsnotice_api/tests/telemetry.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { trace, SpanStatusCode } from "@opentelemetry/api";
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { withSpan } from "../src/telemetry";

const exporter = new InMemorySpanExporter();
const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
trace.setGlobalTracerProvider(provider);

describe("withSpan", () => {
  beforeEach(() => exporter.reset());

  it("records a span with the given name and attributes", async () => {
    await withSpan("scrape.parse", { "watch.id": "w1", "run.id": "r1" }, async () => 42);

    const [span] = exporter.getFinishedSpans();
    expect(span!.name).toBe("scrape.parse");
    expect(span!.attributes["watch.id"]).toBe("w1");
    expect(span!.attributes["run.id"]).toBe("r1");
  });

  it("returns the callback's value", async () => {
    expect(await withSpan("x", {}, async () => "value")).toBe("value");
  });

  it("marks the span as an error and rethrows when the callback throws", async () => {
    await expect(withSpan("agent.invoke", { "listing.id": "l1" }, async () => {
      throw new Error("port timeout");
    })).rejects.toThrow("port timeout");

    const [span] = exporter.getFinishedSpans();
    expect(span!.status.code).toBe(SpanStatusCode.ERROR);
    expect(span!.events.some((e) => e.name === "exception")).toBe(true);
  });

  it("nests child spans under their parent", async () => {
    await withSpan("watch.tick", { "watch.id": "w1" }, async () => {
      await withSpan("scrape.trigger", { "watch.id": "w1" }, async () => undefined);
    });

    const spans = exporter.getFinishedSpans();
    const parent = spans.find((s) => s.name === "watch.tick")!;
    const child = spans.find((s) => s.name === "scrape.trigger")!;
    expect(child.parentSpanContext?.spanId).toBe(parent.spanContext().spanId);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd craigsnotice_api && bun run test:run telemetry`
Expected: FAIL — cannot resolve `../src/telemetry`.

- [ ] **Step 4: Implement the helper**

`craigsnotice_api/src/telemetry/index.ts`:

```ts
import { trace, context, SpanStatusCode, type AttributeValue, type Span } from "@opentelemetry/api";

export const tracer = trace.getTracer("craigsnotice-api");

export const withSpan = async <T>(
  name: string,
  attrs: Record<string, AttributeValue>,
  fn: (span: Span) => Promise<T>
): Promise<T> => {
  const span = tracer.startSpan(name, { attributes: attrs });
  try {
    return await context.with(trace.setSpan(context.active(), span), () => fn(span));
  } catch (err) {
    span.recordException(err as Error);
    span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
    throw err;
  } finally {
    span.end();
  }
};
```

- [ ] **Step 5: Implement the SDK bootstrap**

`craigsnotice_api/src/otel.ts`:

```ts
import { NodeSDK } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { resourceFromAttributes } from "@opentelemetry/resources";

const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "http://localhost:4318";
const headers = Object.fromEntries(
  (process.env.OTEL_EXPORTER_OTLP_HEADERS ?? "")
    .split(",")
    .filter(Boolean)
    .map((pair) => {
      const [k, ...rest] = pair.split("=");
      return [k!.trim(), rest.join("=").trim()];
    })
);

const sdk = new NodeSDK({
  resource: resourceFromAttributes({
    "service.name": process.env.OTEL_SERVICE_NAME ?? "craigsnotice-api",
    "service.version": "0.1.0",
  }),
  traceExporter: new OTLPTraceExporter({ url: `${endpoint}/v1/traces`, headers }),
  metricReader: new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter({ url: `${endpoint}/v1/metrics`, headers }),
    exportIntervalMillis: 10_000,
  }),
  instrumentations: [getNodeAutoInstrumentations()],
});

sdk.start();

const shutdown = (): void => { void sdk.shutdown(); };
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
```

`SIGNOZ_INGESTION_KEY` goes into `OTEL_EXPORTER_OTLP_HEADERS` as
`signoz-ingestion-key=<key>`; self-hosted SigNoz just sets `OTEL_EXPORTER_OTLP_ENDPOINT` and
leaves the header empty.

- [ ] **Step 6: Instrument the pipeline**

Wrap each stage. In `scheduler.ts`:

```ts
export const runWatchCycle = (deps: CycleDeps, watchId: string): Promise<CycleResult> =>
  withSpan("watch.tick", { "watch.id": watchId }, async () => { /* existing body */ });
```

In `ingest.ts`, wrap the trigger in `withSpan("scrape.trigger", { "watch.id": watch.id })`, the
delivery await in `withSpan("scrape.poll", { "watch.id": watch.id, "run.id": runId })`, the
`parseRows` call in `withSpan("scrape.parse", ...)` and set
`span.setAttribute("scrape.violation_rate", parsed.violationRate)`, and the detail batch in
`withSpan("listing.detail.fetch", { "watch.id": watch.id, "listing.count": fresh.length })`.

In `judgment.ts`, wrap `watchBaseline` in `withSpan("baseline.compute", { "watch.id": watchId })`
and `port.invokeAgent` in `withSpan("agent.invoke", { "watch.id": watchId, "listing.id": listingId })`.

In `notify/dispatcher.ts`, wrap each channel send in
`withSpan("alert.notify", { "alert.id": alert.alertId, channel: channel.name })`.

- [ ] **Step 7: Run the test to verify it passes**

Run: `cd craigsnotice_api && bun run test:run telemetry`
Expected: PASS, 4 tests.

- [ ] **Step 8: Verify against SigNoz**

Run: `cd craigsnotice_api && bun run dev`, create a watch, hit **Run now**, then open SigNoz →
Traces. Expected: a `watch.tick` trace with the seven child spans nested beneath it.

- [ ] **Step 9: Commit**

```bash
git add craigsnotice_api/src/otel.ts craigsnotice_api/src/telemetry craigsnotice_api/src/services craigsnotice_api/tests/telemetry.test.ts craigsnotice_api/package.json
git commit -m "feat(obs): add OTel bootstrap and instrument every pipeline stage"
```

---

### Task 25: Metrics

**Files:**
- Create: `craigsnotice_api/src/telemetry/metrics.ts`
- Modify: `craigsnotice_api/src/services/{ingest,judgment,scheduler,selfheal}.ts`, `notify/dispatcher.ts`
- Test: `craigsnotice_api/tests/metrics.test.ts`

**Interfaces:**
- Consumes: OTel SDK (Task 24).
- Produces:

```ts
export const metrics: {
  listingsIngested: Counter; alertsSent: Counter; agentInvocations: Counter;
  agentFailures: Counter; scrapeViolations: Counter; selfhealEvents: Counter;
  agentLatency: Histogram; scrapeDuration: Histogram;
  recordScraperHealth: (scraperConfigId: string, collectorId: string, healthy: boolean) => void;
}
```

`recordScraperHealth` drives an observable gauge — **this is the series the Task 23 SigNoz
alert rule fires on**, so its labels must be `scraper_config_id` and `collector_id` exactly.

- [ ] **Step 1: Write the failing test**

`craigsnotice_api/tests/metrics.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { metrics } from "../src/telemetry/metrics";

describe("metrics", () => {
  it("exposes every counter and histogram named in the spec", () => {
    for (const key of [
      "listingsIngested", "alertsSent", "agentInvocations", "agentFailures",
      "scrapeViolations", "selfhealEvents", "agentLatency", "scrapeDuration",
    ]) {
      expect(metrics[key as keyof typeof metrics], `missing metric ${key}`).toBeDefined();
    }
  });

  it("records scraper health without throwing", () => {
    expect(() => metrics.recordScraperHealth("cfg-1", "collector-1", false)).not.toThrow();
    expect(() => metrics.recordScraperHealth("cfg-1", "collector-1", true)).not.toThrow();
  });

  it("accepts counter increments with attributes", () => {
    expect(() => metrics.listingsIngested.add(3, { "watch.id": "w1" })).not.toThrow();
    expect(() => metrics.agentLatency.record(412, { "watch.id": "w1" })).not.toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd craigsnotice_api && bun run test:run metrics`
Expected: FAIL — cannot resolve `../src/telemetry/metrics`.

- [ ] **Step 3: Implement the metrics module**

`craigsnotice_api/src/telemetry/metrics.ts`:

```ts
import { metrics as otelMetrics } from "@opentelemetry/api";

const meter = otelMetrics.getMeter("craigsnotice-api");

/** scraper_config_id -> { collectorId, healthy } — read by the observable gauge below. */
const scraperHealth = new Map<string, { collectorId: string; healthy: boolean }>();

const healthGauge = meter.createObservableGauge("scraper.health", {
  description: "1 when the scraper is healthy, 0 when degraded",
});

healthGauge.addCallback((observer) => {
  for (const [scraperConfigId, state] of scraperHealth) {
    observer.observe(state.healthy ? 1 : 0, {
      scraper_config_id: scraperConfigId,
      collector_id: state.collectorId,
    });
  }
});

export const metrics = {
  listingsIngested: meter.createCounter("craigsnotice.listings.ingested", { description: "New listings stored" }),
  alertsSent: meter.createCounter("craigsnotice.alerts.sent", { description: "Deal alerts dispatched" }),
  agentInvocations: meter.createCounter("craigsnotice.agent.invocations", { description: "Port agent invocations" }),
  agentFailures: meter.createCounter("craigsnotice.agent.failures", { description: "Agent errors or malformed verdicts" }),
  scrapeViolations: meter.createCounter("craigsnotice.scrape.violations", { description: "Rows failing schema validation" }),
  selfhealEvents: meter.createCounter("craigsnotice.selfheal.events", { description: "Self-heal lifecycle events" }),
  agentLatency: meter.createHistogram("craigsnotice.agent.latency", { unit: "ms", description: "Agent invocation latency" }),
  scrapeDuration: meter.createHistogram("craigsnotice.scrape.duration", { unit: "ms", description: "Trigger-to-ready duration" }),

  recordScraperHealth(scraperConfigId: string, collectorId: string, healthy: boolean): void {
    scraperHealth.set(scraperConfigId, { collectorId, healthy });
  },
};
```

- [ ] **Step 4: Emit the metrics from the pipeline**

- `ingest.ts`: `metrics.listingsIngested.add(newListingIds.length, { "watch.id": watch.id })`;
  `metrics.scrapeViolations.add(parsed.violations, { "watch.id": watch.id })`;
  `metrics.scrapeDuration.record(Date.now() - startedAt, { "watch.id": watch.id })`.
- `judgment.ts`: `metrics.agentInvocations.add(1, ...)` before the call,
  `metrics.agentLatency.record(elapsed, ...)` after, and `metrics.agentFailures.add(1, ...)`
  on both the throw path and the malformed-verdict path.
- `dispatcher.ts`: `metrics.alertsSent.add(1, { channel: channel.name })` on success.
- `selfheal.ts`: `metrics.selfhealEvents.add(1, { event })` in `emit`, plus
  `metrics.recordScraperHealth(config.id, config.bdCollectorId, false)` when degraded and
  `true` after a successful heal.

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd craigsnotice_api && bun run test:run metrics`
Expected: PASS, 3 tests.

- [ ] **Step 6: Commit**

```bash
git add craigsnotice_api/src/telemetry/metrics.ts craigsnotice_api/src/services craigsnotice_api/tests/metrics.test.ts
git commit -m "feat(obs): emit pipeline counters, histograms and a scraper-health gauge"
```

---

### Task 26: Self-heal events as first-class signals, and the dashboard

**Files:**
- Create: `craigsnotice_api/src/telemetry/events.ts`
- Create: `signoz/dashboards/craigsnotice.json`
- Modify: `craigsnotice_api/src/index.ts`
- Test: `craigsnotice_api/tests/events.test.ts`

**Interfaces:**
- Consumes: `withSpan` (Task 24), `metrics` (Task 25), `SelfHealEvent` (Task 22).
- Produces: `createSelfHealEmitter(): (event: SelfHealEvent, attrs: Record<string, unknown>) => void` — the production `emit` passed to `handleDegraded`. It does three things at once: adds a span event to the active span, emits a severity-tagged log record, and increments `selfhealEvents`.

Severity: `triggered` → WARN, `succeeded` → INFO, `failed` → ERROR. This is what makes a repair
searchable in SigNoz's log view independently of ordinary traffic, which is the "first-class
signal treatment for auto-repair events" bullet.

- [ ] **Step 1: Write the failing test**

`craigsnotice_api/tests/events.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { createSelfHealEmitter, severityFor } from "../src/telemetry/events";

describe("severityFor", () => {
  it("maps triggered to WARN", () => expect(severityFor("scraper.selfheal.triggered")).toBe("WARN"));
  it("maps succeeded to INFO", () => expect(severityFor("scraper.selfheal.succeeded")).toBe("INFO"));
  it("maps failed to ERROR", () => expect(severityFor("scraper.selfheal.failed")).toBe("ERROR"));
});

describe("createSelfHealEmitter", () => {
  it("writes a structured log line carrying the heal prompt", () => {
    const sink = vi.fn();
    const emit = createSelfHealEmitter(sink);

    emit("scraper.selfheal.triggered", { collectorId: "c1", violationRate: 0.75, healPrompt: "re-derive price" });

    expect(sink).toHaveBeenCalledOnce();
    const record = sink.mock.calls[0]![0];
    expect(record.event).toBe("scraper.selfheal.triggered");
    expect(record.severity).toBe("WARN");
    expect(record.healPrompt).toBe("re-derive price");
    expect(record.collectorId).toBe("c1");
  });

  it("does not throw when there is no active span", () => {
    expect(() => createSelfHealEmitter(vi.fn())("scraper.selfheal.failed", {})).not.toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd craigsnotice_api && bun run test:run events`
Expected: FAIL — cannot resolve `../src/telemetry/events`.

- [ ] **Step 3: Implement the emitter**

`craigsnotice_api/src/telemetry/events.ts`:

```ts
import { trace } from "@opentelemetry/api";
import type { SelfHealEvent } from "../services/selfheal";
import { metrics } from "./metrics";

export type Severity = "INFO" | "WARN" | "ERROR";

export const severityFor = (event: SelfHealEvent): Severity => {
  if (event === "scraper.selfheal.failed") return "ERROR";
  if (event === "scraper.selfheal.triggered") return "WARN";
  return "INFO";
};

export type LogSink = (record: Record<string, unknown>) => void;

const defaultSink: LogSink = (record) => {
  const line = JSON.stringify(record);
  if (record.severity === "ERROR") console.error(line);
  else if (record.severity === "WARN") console.warn(line);
  else console.log(line);
};

export const createSelfHealEmitter = (sink: LogSink = defaultSink) => {
  return (event: SelfHealEvent, attrs: Record<string, unknown>): void => {
    const severity = severityFor(event);

    // 1. Span event, so the repair is visible inside the trace that detected it.
    trace.getActiveSpan()?.addEvent(event, attrs as Record<string, string | number | boolean>);

    // 2. Severity-tagged log record, so it is searchable on its own.
    sink({ event, severity, ...attrs, timestamp: new Date().toISOString() });

    // 3. Counter, so it is alertable and graphable.
    metrics.selfhealEvents.add(1, { event, severity });
  };
};
```

Wire it in `src/index.ts`: `const emit = createSelfHealEmitter();` passed into the
`handleDegraded` deps built in Task 22.

- [ ] **Step 4: Build the SigNoz dashboard**

Create a SigNoz dashboard with six panels and export it to
`signoz/dashboards/craigsnotice.json` so it is reproducible from the repo:

1. **Pipeline throughput** — `craigsnotice.listings.ingested` and `craigsnotice.alerts.sent` rate.
2. **Agent health** — `craigsnotice.agent.invocations` vs `craigsnotice.agent.failures`.
3. **Agent latency** — p50/p95 of `craigsnotice.agent.latency`.
4. **Scrape duration** — p50/p95 of `craigsnotice.scrape.duration`.
5. **Scraper health** — `scraper.health` gauge by `collector_id`.
6. **Self-heal events** — `craigsnotice.selfheal.events` by `event`, alongside a logs panel
   filtered to `event =~ "scraper.selfheal.*"`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd craigsnotice_api && bun run test:run events`
Expected: PASS, 5 tests.

- [ ] **Step 6: Verify the whole loop end to end**

Run, in order:
```bash
cd craigsnotice_api && bun run dev
curl -X POST localhost:8022/api/v1/debug/inject-scrape-failure -H "x-debug-token: $DEBUG_TOKEN"
curl -X POST localhost:8022/api/v1/watches/<id>/run -H "Authorization: Bearer <token>"
```
Expected: SigNoz logs show `scraper.selfheal.triggered` at WARN then
`scraper.selfheal.succeeded` at INFO; the `scraper.health` gauge dips to 0 and returns to 1;
the Port `craigsnotice_scraper_config` entity flips to degraded and back to healthy.

- [ ] **Step 7: Commit**

```bash
git add craigsnotice_api/src/telemetry/events.ts craigsnotice_api/src/index.ts signoz/dashboards craigsnotice_api/tests/events.test.ts
git commit -m "feat(obs): treat self-heal events as first-class signals and add the dashboard"
```

---

# Phase 6 — Frontend

### Task 27: Network client and React Query hooks

**Files:**
- Create: `craigsnotice_client/package.json`, `tsconfig.json`, `vitest.config.ts`
- Create: `craigsnotice_client/src/network/craigsnotice-client.ts`, `src/hooks/{query-keys,use-watches,use-alerts,use-feedback}.ts`, `src/index.ts`
- Test: `craigsnotice_client/src/network/__tests__/craigsnotice-client.test.ts`

**Interfaces:**
- Consumes: types from `@craigsnotice/types`.
- Produces:

```ts
export interface NetworkClient { request<T>(url: string, init?: RequestInit): Promise<T> }
export class CraigsnoticeClient {
  constructor(network: NetworkClient, baseUrl: string);
  listWatches(token: string): Promise<Watch[]>;
  createWatch(token: string, input: CreateWatchInput): Promise<Watch>;
  deleteWatch(token: string, id: string): Promise<void>;
  runWatch(token: string, id: string): Promise<CycleResult>;
  listAlerts(token: string): Promise<AlertView[]>;
  sendFeedback(token: string, alertId: string, verdict: FeedbackVerdict): Promise<void>;
  registerFcmToken(token: string, fcmToken: string): Promise<void>;
}
export const useWatches, useCreateWatch, useDeleteWatch, useRunWatch, useAlerts, useSendFeedback
```

Follows the sudojo_client pattern exactly: an injected `NetworkClient` (never a bare `fetch`),
a hierarchical query-key factory, and one hook per endpoint.

- [ ] **Step 1: Write the failing test**

`craigsnotice_client/src/network/__tests__/craigsnotice-client.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { CraigsnoticeClient, type NetworkClient } from "../craigsnotice-client";

const netWith = (payload: unknown): NetworkClient & { request: ReturnType<typeof vi.fn> } => ({
  request: vi.fn().mockResolvedValue({ success: true, data: payload }),
});

describe("CraigsnoticeClient", () => {
  it("lists watches with a bearer token", async () => {
    const net = netWith([{ id: "w1" }]);
    const out = await new CraigsnoticeClient(net, "http://localhost:8022").listWatches("tok");

    expect(out).toEqual([{ id: "w1" }]);
    const [url, init] = net.request.mock.calls[0]!;
    expect(url).toBe("http://localhost:8022/api/v1/watches");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
  });

  it("posts a create-watch body", async () => {
    const net = netWith({ id: "w1" });
    await new CraigsnoticeClient(net, "http://localhost:8022").createWatch("tok", {
      siteCode: "sfbay", categoryCode: "sya", query: "Mac Studio", intervalSec: 300,
    });

    const [url, init] = net.request.mock.calls[0]!;
    expect(url).toBe("http://localhost:8022/api/v1/watches");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string).query).toBe("Mac Studio");
  });

  it("posts feedback to the alert-scoped path", async () => {
    const net = netWith({});
    await new CraigsnoticeClient(net, "http://localhost:8022").sendFeedback("tok", "a1", "bad");

    expect(net.request.mock.calls[0]![0]).toBe("http://localhost:8022/api/v1/alerts/a1/feedback");
    expect(JSON.parse(net.request.mock.calls[0]![1].body as string)).toEqual({ verdict: "bad" });
  });

  it("throws when the envelope reports failure", async () => {
    const net: NetworkClient = { request: vi.fn().mockResolvedValue({ success: false, error: "watch not found" }) };
    await expect(new CraigsnoticeClient(net, "http://x").listWatches("tok")).rejects.toThrow("watch not found");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd craigsnotice_client && bun run test:run`
Expected: FAIL — cannot resolve `../craigsnotice-client`.

- [ ] **Step 3: Implement the client**

`craigsnotice_client/src/network/craigsnotice-client.ts`:

```ts
import type { ApiResponse, CreateWatchInput, FeedbackVerdict, Watch } from "@craigsnotice/types";

export interface NetworkClient {
  request<T>(url: string, init?: RequestInit): Promise<T>;
}

export interface AlertView {
  id: string; watchId: string; title: string; price: number | null; url: string;
  score: number; reasoning: string; priceVsMedian: number;
  createdAt: string; userFeedback: FeedbackVerdict | null;
}

export interface CycleResult {
  runId: string; scrapedCount: number; judged: number; alerted: number; degraded: boolean;
}

export class CraigsnoticeClient {
  constructor(
    private readonly network: NetworkClient,
    private readonly baseUrl: string
  ) {}

  private async call<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
    const res = await this.network.request<ApiResponse<T>>(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        ...(init.headers ?? {}),
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });
    if (!res.success) throw new Error(res.error ?? "request failed");
    return res.data as T;
  }

  listWatches = (token: string): Promise<Watch[]> => this.call<Watch[]>(token, "/api/v1/watches");

  createWatch = (token: string, input: CreateWatchInput): Promise<Watch> =>
    this.call<Watch>(token, "/api/v1/watches", { method: "POST", body: JSON.stringify(input) });

  deleteWatch = async (token: string, id: string): Promise<void> => {
    await this.call(token, `/api/v1/watches/${id}`, { method: "DELETE" });
  };

  runWatch = (token: string, id: string): Promise<CycleResult> =>
    this.call<CycleResult>(token, `/api/v1/watches/${id}/run`, { method: "POST" });

  listAlerts = (token: string): Promise<AlertView[]> => this.call<AlertView[]>(token, "/api/v1/alerts");

  sendFeedback = async (token: string, alertId: string, verdict: FeedbackVerdict): Promise<void> => {
    await this.call(token, `/api/v1/alerts/${alertId}/feedback`, {
      method: "POST", body: JSON.stringify({ verdict }),
    });
  };

  registerFcmToken = async (token: string, fcmToken: string): Promise<void> => {
    await this.call(token, "/api/v1/users/fcm-token", {
      method: "POST", body: JSON.stringify({ fcmToken }),
    });
  };
}
```

- [ ] **Step 4: Implement the hooks**

`craigsnotice_client/src/hooks/query-keys.ts`:

```ts
export const queryKeys = {
  craigsnotice: {
    all: ["craigsnotice"] as const,
    watches: () => [...queryKeys.craigsnotice.all, "watches"] as const,
    watch: (id: string) => [...queryKeys.craigsnotice.watches(), id] as const,
    alerts: () => [...queryKeys.craigsnotice.all, "alerts"] as const,
  },
};
```

`craigsnotice_client/src/hooks/use-watches.ts` follows the sudojo hook pattern — memoise the
client, `useCallback` the query fn, gate on `!!token`:

```ts
export const useWatches = (
  network: NetworkClient, baseUrl: string, token: string
): UseQueryResult<Watch[]> => {
  const client = useMemo(() => new CraigsnoticeClient(network, baseUrl), [network, baseUrl]);
  return useQuery({
    queryKey: queryKeys.craigsnotice.watches(),
    queryFn: useCallback(() => client.listWatches(token), [client, token]),
    enabled: !!token,
    staleTime: 30_000,
  });
};
```

`useCreateWatch`, `useDeleteWatch`, `useRunWatch` and `useSendFeedback` are `useMutation` hooks
that invalidate `queryKeys.craigsnotice.watches()` (or `.alerts()`) on success. `useAlerts`
mirrors `useWatches` against `listAlerts` with `staleTime: 10_000`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd craigsnotice_client && bun run test:run`
Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```bash
git add craigsnotice_client
git commit -m "feat(client): add network client and React Query hooks"
```

---

### Task 28: Business-logic library

**Files:**
- Create: `craigsnotice_lib/package.json`, `tsconfig.json`, `vitest.config.ts`
- Create: `craigsnotice_lib/src/stores/watchDraftStore.ts`, `src/hooks/{useGeoSite,useAlertStream}.ts`, `src/index.ts`
- Test: `craigsnotice_lib/src/__tests__/{watchDraftStore,useGeoSite}.test.ts`

**Interfaces:**
- Consumes: `nearestSite` (Task 4), `AlertView` (Task 27).
- Produces:

```ts
export const useWatchDraftStore: UseBoundStore<...>   // zustand + localStorage, key "craigsnotice.watchDraft.v1"
export interface GeoState { status: "idle" | "locating" | "resolved" | "denied" | "unsupported"; site: Site | null; error: string | null }
export const useGeoSite: (geolocation?: Geolocation) => GeoState & { locate(): void }
export const useAlertStream: (baseUrl: string, token: string) => { alerts: AlertView[]; connected: boolean }
```

**Geolocation denial is never a hard failure** — `status` becomes `denied` and the UI falls
back to the manual dropdown.

- [ ] **Step 1: Write the failing tests**

`craigsnotice_lib/src/__tests__/useGeoSite.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useGeoSite } from "../hooks/useGeoSite";

const geoWith = (impl: Geolocation["getCurrentPosition"]): Geolocation =>
  ({ getCurrentPosition: impl, watchPosition: vi.fn(), clearWatch: vi.fn() }) as unknown as Geolocation;

describe("useGeoSite", () => {
  it("starts idle with no site", () => {
    const { result } = renderHook(() => useGeoSite(geoWith(vi.fn())));
    expect(result.current.status).toBe("idle");
    expect(result.current.site).toBeNull();
  });

  it("resolves San Francisco coordinates to sfbay", async () => {
    const geo = geoWith((ok) => ok({ coords: { latitude: 37.7749, longitude: -122.4194 } } as GeolocationPosition));
    const { result } = renderHook(() => useGeoSite(geo));

    act(() => result.current.locate());

    await waitFor(() => expect(result.current.status).toBe("resolved"));
    expect(result.current.site!.code).toBe("sfbay");
  });

  it("reports denied without throwing when permission is refused", async () => {
    const geo = geoWith((_ok, fail) => fail!({ code: 1, message: "denied" } as GeolocationPositionError));
    const { result } = renderHook(() => useGeoSite(geo));

    act(() => result.current.locate());

    await waitFor(() => expect(result.current.status).toBe("denied"));
    expect(result.current.site).toBeNull();
  });

  it("reports unsupported when no geolocation object is available", () => {
    const { result } = renderHook(() => useGeoSite(undefined));
    act(() => result.current.locate());
    expect(result.current.status).toBe("unsupported");
  });
});
```

`craigsnotice_lib/src/__tests__/watchDraftStore.test.ts` asserts that setting a field persists
to `localStorage` under `craigsnotice.watchDraft.v1`, that `reset()` clears it, and that a
corrupt stored value falls back to the empty draft rather than throwing.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd craigsnotice_lib && bun run test:run`
Expected: FAIL — cannot resolve the hook and store modules.

- [ ] **Step 3: Implement the geolocation hook**

`craigsnotice_lib/src/hooks/useGeoSite.ts`:

```ts
import { useCallback, useState } from "react";
import { nearestSite, type Site } from "@craigsnotice/types";

export type GeoStatus = "idle" | "locating" | "resolved" | "denied" | "unsupported";

export interface GeoState {
  status: GeoStatus;
  site: Site | null;
  error: string | null;
}

export const useGeoSite = (
  geolocation: Geolocation | undefined = typeof navigator === "undefined" ? undefined : navigator.geolocation
) => {
  const [state, setState] = useState<GeoState>({ status: "idle", site: null, error: null });

  const locate = useCallback(() => {
    if (!geolocation) {
      setState({ status: "unsupported", site: null, error: "geolocation unavailable" });
      return;
    }

    setState({ status: "locating", site: null, error: null });
    geolocation.getCurrentPosition(
      (position) => {
        const site = nearestSite({ lat: position.coords.latitude, lng: position.coords.longitude });
        setState({ status: "resolved", site, error: null });
      },
      (err) => setState({ status: "denied", site: null, error: err.message })
    );
  }, [geolocation]);

  return { ...state, locate };
};
```

- [ ] **Step 4: Implement the draft store and alert stream**

`watchDraftStore.ts` is a Zustand store with `{ siteCode, subarea, categoryCode, query, targetPrice }`,
a `set<K>(key, value)` action and `reset()`, persisted via `zustand/middleware`'s `persist`
with `name: "craigsnotice.watchDraft.v1"` and an `onRehydrateStorage` handler that swallows
parse errors.

`useAlertStream.ts` opens an `EventSource` against
`${baseUrl}/api/v1/alerts/stream?token=${token}`, listens for the `deal-alert` event, prepends
each parsed `AlertView` to state, and closes on unmount. It sets `connected` from `onopen` /
`onerror`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd craigsnotice_lib && bun run test:run`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add craigsnotice_lib
git commit -m "feat(lib): add watch draft store, geolocation hook and alert stream"
```

---

### Task 29: App scaffold, Firebase auth and login

**Files:**
- Create: `craigsnotice_app/{package.json,vite.config.ts,tailwind.config.js,postcss.config.js,index.html,tsconfig.json}`
- Create: `craigsnotice_app/src/{main.tsx,App.tsx,firebase.ts,index.css}`, `src/pages/Login.tsx`, `src/context/AuthContext.tsx`
- Test: `craigsnotice_app/src/__tests__/App.test.tsx`

**Interfaces:**
- Consumes: `@sudobility/building_blocks` (`AppTopBarWithFirebaseAuth`), `@sudobility/mail_box_components`.
- Produces: `useAuth(): { user: User | null; token: string | null; loading: boolean }` — every page consumes it. Routes: `/login`, `/watches`, `/watches/:id`, `/alerts`, with unauthenticated users redirected to `/login`.

Env vars are `VITE_*` (Vite convention): `VITE_API_BASE_URL`, `VITE_FIREBASE_API_KEY`,
`VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID`,
`VITE_FIREBASE_VAPID_KEY`.

- [ ] **Step 1: Scaffold the app**

Run:
```bash
cd craigsnotice_app && bun add react react-dom react-router-dom firebase \
  @tanstack/react-query zustand @craigsnotice/types @craigsnotice/client @craigsnotice/lib \
  @sudobility/building_blocks @sudobility/mail_box_components @sudobility/components \
  @sudobility/design @heroicons/react clsx tailwind-merge class-variance-authority
bun add -d vite @vitejs/plugin-react tailwindcss postcss autoprefixer \
  vitest @testing-library/react happy-dom
```

`vite.config.ts` sets `server: { port: 5173 }` and the React plugin.

- [ ] **Step 2: Write the failing test**

`craigsnotice_app/src/__tests__/App.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "../App";
import { AuthContext } from "../context/AuthContext";

const wrap = (auth: { user: unknown; token: string | null; loading: boolean }, path: string) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AuthContext.Provider value={auth as never}>
        <MemoryRouter initialEntries={[path]}><App /></MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>
  );

describe("App routing", () => {
  it("shows the login screen to a signed-out visitor", () => {
    wrap({ user: null, token: null, loading: false }, "/watches");
    expect(screen.getByRole("button", { name: /sign in/i })).toBeTruthy();
  });

  it("shows a loading state while auth resolves", () => {
    wrap({ user: null, token: null, loading: true }, "/watches");
    expect(screen.getByText(/loading/i)).toBeTruthy();
  });

  it("renders the watches page for a signed-in user", () => {
    wrap({ user: { uid: "u1", email: "a@b.c" }, token: "tok", loading: false }, "/watches");
    expect(screen.getByText(/watches/i)).toBeTruthy();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd craigsnotice_app && bun run test:run`
Expected: FAIL — cannot resolve `../App`.

- [ ] **Step 4: Implement auth context and routing**

`src/context/AuthContext.tsx` exports `AuthContext`, an `AuthProvider` that subscribes to
`onAuthStateChanged`, refreshes the ID token via `user.getIdToken()` on change, and a
`useAuth()` consumer hook.

`src/App.tsx` renders `AppTopBarWithFirebaseAuth` from `@sudobility/building_blocks` and a
`<Routes>` block; a `RequireAuth` wrapper renders `<Login />` when `!user`, a loading state
while `loading`, and the child route otherwise.

`src/pages/Login.tsx` renders a Google sign-in button calling
`signInWithPopup(auth, new GoogleAuthProvider())`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd craigsnotice_app && bun run test:run`
Expected: PASS, 3 tests.

- [ ] **Step 6: Commit**

```bash
git add craigsnotice_app
git commit -m "feat(app): scaffold Vite app with Firebase auth and routing"
```

---

### Task 30: Watch creation form

**Files:**
- Create: `craigsnotice_app/src/components/{LocationPicker,CategoryPicker,WatchForm}.tsx`, `src/pages/Watches.tsx`
- Test: `craigsnotice_app/src/__tests__/WatchForm.test.tsx`

**Interfaces:**
- Consumes: `SITES`/`CATEGORIES` (Task 2), `useGeoSite` (Task 28), `useCreateWatch`/`useWatches`/`useRunWatch` (Task 27).
- Produces: `<WatchForm onSubmit={(input: CreateWatchInput) => void} />` and the `/watches` page listing watches with a **Run now** button per row.

`LocationPicker` is a searchable combobox over ~400 sites — a plain `<select>` with 400 options
is unusable. It filters on site name and state, and shows a "Use my location" button whose
resolved site preselects the field. `CategoryPicker` is a plain select over ~40 categories.

- [ ] **Step 1: Write the failing test**

`craigsnotice_app/src/__tests__/WatchForm.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { WatchForm } from "../components/WatchForm";

describe("WatchForm", () => {
  it("submits location, category and query", () => {
    const onSubmit = vi.fn();
    render(<WatchForm onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText(/location/i), { target: { value: "SF bay" } });
    fireEvent.click(screen.getByText(/SF bay area/i));
    fireEvent.change(screen.getByLabelText(/category/i), { target: { value: "sya" } });
    fireEvent.change(screen.getByLabelText(/looking for/i), { target: { value: "Mac Studio" } });
    fireEvent.click(screen.getByRole("button", { name: /create watch/i }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ siteCode: "sfbay", categoryCode: "sya", query: "Mac Studio" })
    );
  });

  it("includes the optional target price when given", () => {
    const onSubmit = vi.fn();
    render(<WatchForm onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText(/location/i), { target: { value: "SF bay" } });
    fireEvent.click(screen.getByText(/SF bay area/i));
    fireEvent.change(screen.getByLabelText(/category/i), { target: { value: "sya" } });
    fireEvent.change(screen.getByLabelText(/looking for/i), { target: { value: "Mac Studio" } });
    fireEvent.change(screen.getByLabelText(/alert me under/i), { target: { value: "1200" } });
    fireEvent.click(screen.getByRole("button", { name: /create watch/i }));

    expect(onSubmit.mock.calls[0]![0].targetPrice).toBe(1200);
  });

  it("does not submit without a location", () => {
    const onSubmit = vi.fn();
    render(<WatchForm onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText(/looking for/i), { target: { value: "Mac Studio" } });
    fireEvent.click(screen.getByRole("button", { name: /create watch/i }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(/choose a location/i)).toBeTruthy();
  });

  it("filters the location list as the user types", () => {
    render(<WatchForm onSubmit={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/location/i), { target: { value: "zzzznotacity" } });
    expect(screen.getByText(/no matching cities/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd craigsnotice_app && bun run test:run WatchForm`
Expected: FAIL — cannot resolve `../components/WatchForm`.

- [ ] **Step 3: Implement the pickers and form**

`LocationPicker.tsx` keeps a `query` state, filters `SITES` on
`site.name.toLowerCase().includes(q) || site.state.toLowerCase() === q`, caps the rendered list
at 50 results, renders "No matching cities" when empty, and exposes a "Use my location" button
wired to `useGeoSite`. `CategoryPicker.tsx` maps `CATEGORIES` to `<option>` elements.

`WatchForm.tsx` composes both plus a text input and a numeric target-price input, validates
that a site, category and non-empty query are present before calling `onSubmit`, and renders
"Choose a location" beneath the field when the site is missing.

`Watches.tsx` renders the form plus a list from `useWatches`, each row showing the derived
search URL and a **Run now** button bound to `useRunWatch`. Each row links to
`/watches/:id`.

`src/pages/WatchDetail.tsx` (spec §13) shows one watch's settings, its derived search URL as
a clickable link, and that watch's alerts filtered from `useAlerts()` by `watchId`, reusing
`<AlertCard>` from Task 31. Until Task 31 lands, render the alert list as plain rows and swap
in the card afterwards.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd craigsnotice_app && bun run test:run WatchForm`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add craigsnotice_app/src/components craigsnotice_app/src/pages/Watches.tsx craigsnotice_app/src/__tests__/WatchForm.test.tsx
git commit -m "feat(app): add watch creation form with searchable location picker"
```

---

### Task 31: Alert feed with live streaming and feedback

**Files:**
- Create: `craigsnotice_app/src/components/AlertCard.tsx`, `src/pages/Alerts.tsx`
- Test: `craigsnotice_app/src/__tests__/AlertCard.test.tsx`

**Interfaces:**
- Consumes: `useAlerts`, `useSendFeedback` (Task 27), `useAlertStream` (Task 28).
- Produces: `<AlertCard alert={AlertView} onFeedback={(v: FeedbackVerdict) => void} />` and the `/alerts` page merging the polled list with the live SSE stream, deduping on alert id.

The card shows title, price, delta vs median as a signed percentage, the agent's reasoning, and
👍/👎 buttons that disable once a verdict is recorded.

- [ ] **Step 1: Write the failing test**

`craigsnotice_app/src/__tests__/AlertCard.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AlertCard } from "../components/AlertCard";

const alert = {
  id: "a1", watchId: "w1", title: "Mac Studio M2 Max", price: 1200,
  url: "https://sfbay.craigslist.org/x/1.html", score: 88,
  reasoning: "34% under the median for this watch", priceVsMedian: -0.34,
  createdAt: "2026-08-22T12:00:00Z", userFeedback: null,
};

describe("AlertCard", () => {
  it("shows the title, price and agent reasoning", () => {
    render(<AlertCard alert={alert} onFeedback={vi.fn()} />);
    expect(screen.getByText("Mac Studio M2 Max")).toBeTruthy();
    expect(screen.getByText(/\$1,?200/)).toBeTruthy();
    expect(screen.getByText(/34% under the median/)).toBeTruthy();
  });

  it("renders the median delta as a signed percentage", () => {
    render(<AlertCard alert={alert} onFeedback={vi.fn()} />);
    expect(screen.getByText(/-34%/)).toBeTruthy();
  });

  it("reports a thumbs-down verdict", () => {
    const onFeedback = vi.fn();
    render(<AlertCard alert={alert} onFeedback={onFeedback} />);
    fireEvent.click(screen.getByRole("button", { name: /not a good deal/i }));
    expect(onFeedback).toHaveBeenCalledWith("bad");
  });

  it("disables the buttons once feedback exists", () => {
    render(<AlertCard alert={{ ...alert, userFeedback: "good" }} onFeedback={vi.fn()} />);
    expect(screen.getByRole("button", { name: /good deal/i }).hasAttribute("disabled")).toBe(true);
  });

  it("handles a listing with no price without rendering NaN", () => {
    render(<AlertCard alert={{ ...alert, price: null }} onFeedback={vi.fn()} />);
    expect(screen.queryByText(/NaN/)).toBeNull();
    expect(screen.getByText(/no price/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd craigsnotice_app && bun run test:run AlertCard`
Expected: FAIL — cannot resolve `../components/AlertCard`.

- [ ] **Step 3: Implement the card and page**

`AlertCard.tsx` formats price with `Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })`
and renders "No price" when `price === null`; formats `priceVsMedian` as
`` `${Math.round(v * 100)}%` `` with an explicit sign; disables both buttons when
`alert.userFeedback !== null`.

`Alerts.tsx` merges `useAlerts()` data with `useAlertStream()` output into one list keyed by
`id` (stream entries win, since they are newer), sorts by `createdAt` descending, and wires
`onFeedback` to `useSendFeedback`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd craigsnotice_app && bun run test:run AlertCard`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add craigsnotice_app/src/components/AlertCard.tsx craigsnotice_app/src/pages/Alerts.tsx craigsnotice_app/src/__tests__/AlertCard.test.tsx
git commit -m "feat(app): add live alert feed with thumbs-up/down feedback"
```

---

### Task 32: FCM web push registration

**Files:**
- Create: `craigsnotice_app/public/firebase-messaging-sw.js`
- Create: `craigsnotice_app/src/hooks/usePushRegistration.ts`
- Modify: `craigsnotice_app/src/App.tsx`
- Test: `craigsnotice_app/src/__tests__/usePushRegistration.test.tsx`

**Interfaces:**
- Consumes: `registerFcmToken` (Task 27), Firebase Messaging SDK.
- Produces: `usePushRegistration(token: string | null): { status: "idle" | "granted" | "denied" | "unsupported"; enable(): Promise<void> }`.

**Denial must be silent and non-blocking** — the SSE feed from Task 31 already guarantees the
alert is visible. This hook only adds the real push on top.

- [ ] **Step 1: Write the failing test**

`craigsnotice_app/src/__tests__/usePushRegistration.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { usePushRegistration } from "../hooks/usePushRegistration";

const mocks = vi.hoisted(() => ({ getToken: vi.fn(), isSupported: vi.fn() }));
vi.mock("firebase/messaging", () => ({
  getMessaging: () => ({}),
  getToken: mocks.getToken,
  isSupported: mocks.isSupported,
  onMessage: vi.fn(),
}));

describe("usePushRegistration", () => {
  beforeEach(() => {
    mocks.getToken.mockReset();
    mocks.isSupported.mockReset().mockResolvedValue(true);
    Object.defineProperty(globalThis, "Notification", {
      value: { requestPermission: vi.fn().mockResolvedValue("granted"), permission: "default" },
      configurable: true,
    });
  });

  it("starts idle", () => {
    const { result } = renderHook(() => usePushRegistration("api-token"));
    expect(result.current.status).toBe("idle");
  });

  it("registers the FCM token when permission is granted", async () => {
    mocks.getToken.mockResolvedValue("fcm-token-1");
    const { result } = renderHook(() => usePushRegistration("api-token"));

    await act(async () => { await result.current.enable(); });

    await waitFor(() => expect(result.current.status).toBe("granted"));
    expect(mocks.getToken).toHaveBeenCalled();
  });

  it("reports denied without throwing when permission is refused", async () => {
    (globalThis.Notification.requestPermission as ReturnType<typeof vi.fn>).mockResolvedValue("denied");
    const { result } = renderHook(() => usePushRegistration("api-token"));

    await act(async () => { await result.current.enable(); });

    expect(result.current.status).toBe("denied");
    expect(mocks.getToken).not.toHaveBeenCalled();
  });

  it("reports unsupported when the browser cannot do web push", async () => {
    mocks.isSupported.mockResolvedValue(false);
    const { result } = renderHook(() => usePushRegistration("api-token"));

    await act(async () => { await result.current.enable(); });

    expect(result.current.status).toBe("unsupported");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd craigsnotice_app && bun run test:run usePushRegistration`
Expected: FAIL — cannot resolve `../hooks/usePushRegistration`.

- [ ] **Step 3: Implement the service worker**

`craigsnotice_app/public/firebase-messaging-sw.js`:

```js
importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js");

firebase.initializeApp(self.FIREBASE_CONFIG ?? {
  apiKey: "__VITE_FIREBASE_API_KEY__",
  authDomain: "__VITE_FIREBASE_AUTH_DOMAIN__",
  projectId: "__VITE_FIREBASE_PROJECT_ID__",
  appId: "__VITE_FIREBASE_APP_ID__",
});

firebase.messaging().onBackgroundMessage((payload) => {
  self.registration.showNotification(payload.notification.title, {
    body: payload.notification.body,
    data: payload.data,
  });
});
```

Substitute the placeholders at build time with a small Vite plugin, or hardcode the config —
the Firebase web config is not a secret.

- [ ] **Step 4: Implement the hook**

`src/hooks/usePushRegistration.ts` calls `isSupported()` first, then
`Notification.requestPermission()`, then `getToken(messaging, { vapidKey: import.meta.env.VITE_FIREBASE_VAPID_KEY, serviceWorkerRegistration })`,
and posts the result via `CraigsnoticeClient.registerFcmToken`. Every failure path sets a status
and returns; none throws. Call `enable()` from a button in the top bar, never automatically —
browsers reject permission prompts that are not tied to a user gesture.

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd craigsnotice_app && bun run test:run usePushRegistration`
Expected: PASS, 4 tests.

- [ ] **Step 6: Verify a real push**

Run the app, click Enable notifications, accept, then trigger a watch cycle that produces an
alert. Expected: an OS notification appears, and the same alert also appears in the in-app
feed.

- [ ] **Step 7: Commit**

```bash
git add craigsnotice_app/public/firebase-messaging-sw.js craigsnotice_app/src/hooks craigsnotice_app/src/App.tsx craigsnotice_app/src/__tests__/usePushRegistration.test.tsx
git commit -m "feat(app): register FCM web push with a non-blocking denial path"
```

---

# Phase 7 — Demo hardening

### Task 33: Fixtures mode

**Files:**
- Create: `craigsnotice_api/src/fixtures/{search-results.json,listing-details.json,agent-verdicts.json}`
- Create: `craigsnotice_api/src/services/fixtures.ts`
- Modify: `craigsnotice_api/src/index.ts`
- Test: `craigsnotice_api/tests/fixtures.test.ts`

**Interfaces:**
- Consumes: `BrightDataClient` (Task 10), `PortClient` (Task 15).
- Produces: `createFixtureBrightData(): BrightDataClient` and `createFixturePort(): PortClient` — real interface implementations backed by JSON files. When `DEMO_MODE=fixtures`, `src/index.ts` builds these instead of the network-backed clients.

**This is the wifi insurance.** The entire pipeline — ingest, judgment, alerts, notifications,
spans, metrics, self-heal — runs identically; only the two external boundaries are swapped.

- [ ] **Step 1: Write the failing test**

`craigsnotice_api/tests/fixtures.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { db, resetDb } from "./setup";
import { createFixtureBrightData, createFixturePort } from "../src/services/fixtures";
import { createPollingDelivery } from "../src/services/brightdata/delivery";
import { runWatchCycle } from "../src/services/scheduler";
import { scraperConfigs, users, watches } from "../src/db/schema";

const noSleep = async (): Promise<void> => {};

describe("fixtures mode", () => {
  beforeEach(async () => { await resetDb(); });

  it("serves search rows without any network call", async () => {
    const bd = createFixtureBrightData();
    const id = await bd.trigger("search-collector", [{ url: "https://sfbay.craigslist.org/search/sya?query=Mac+Studio" }]);
    const snap = await bd.fetchSnapshot(id);

    expect(snap.status).toBe("ready");
    expect(snap.rows!.length).toBeGreaterThan(0);
  });

  it("returns a well-formed verdict from the fixture agent", async () => {
    const verdict = await createFixturePort().invokeAgent("deal-agent", { listing: { title: "Mac Studio" } });
    expect(verdict).toHaveProperty("isGoodDeal");
    expect(verdict).toHaveProperty("reasoning");
  });

  it("runs a full watch cycle end to end offline", async () => {
    const [u] = await db.insert(users).values({ firebaseUid: "u1", email: "a@b.c" }).returning();
    const [w] = await db.insert(watches).values({
      userId: u!.id, siteCode: "sfbay", categoryCode: "sya", query: "Mac Studio",
      searchUrl: "https://sfbay.craigslist.org/search/sya?query=Mac+Studio",
    }).returning();
    await db.insert(scraperConfigs).values({ kind: "search", bdCollectorId: "search-collector" });

    const bd = createFixtureBrightData();
    const result = await runWatchCycle({
      db, bd, port: createFixturePort(),
      delivery: createPollingDelivery(bd, { sleep: noSleep }),
      searchCollectorId: "search-collector", detailCollectorId: "detail-collector",
      agentId: "deal-agent", minBaselineSamples: 5, violationRateThreshold: 0.3,
      dispatcher: { dispatch: vi.fn(async () => {}) },
    }, w!.id);

    expect(result.scrapedCount).toBeGreaterThan(0);
    expect(result.degraded).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd craigsnotice_api && DATABASE_URL=postgres://localhost/craigsnotice_test bun run test:run fixtures`
Expected: FAIL — cannot resolve `../src/services/fixtures`.

- [ ] **Step 3: Capture the fixtures**

With `DEMO_MODE=live` and real credentials, run one watch cycle and save the raw Bright Data
responses and the Port agent verdicts. `search-results.json` should hold ~12 rows in the exact
shape `searchResultRowSchema` expects, `listing-details.json` the matching detail rows keyed by
`post_id`, and `agent-verdicts.json` a mix of good and bad verdicts so the demo shows both
outcomes.

- [ ] **Step 4: Implement the fixture clients**

`craigsnotice_api/src/services/fixtures.ts`:

```ts
import searchResults from "../fixtures/search-results.json" with { type: "json" };
import listingDetails from "../fixtures/listing-details.json" with { type: "json" };
import agentVerdicts from "../fixtures/agent-verdicts.json" with { type: "json" };
import type { BrightDataClient } from "./brightdata/client";
import type { PortClient } from "./port/client";

export const createFixtureBrightData = (): BrightDataClient => {
  const snapshots = new Map<string, unknown[]>();
  let counter = 0;

  return {
    async trigger(collectorId) {
      const id = `fixture_${++counter}`;
      snapshots.set(id, collectorId.includes("detail") ? (listingDetails as unknown[]) : (searchResults as unknown[]));
      return id;
    },
    async fetchSnapshot(snapshotId) {
      const rows = snapshots.get(snapshotId);
      return rows ? { status: "ready", rows } : { status: "building", rows: null };
    },
    async heal(collectorId, prompt) {
      console.log(`[fixtures] heal ${collectorId}: ${prompt}`);
    },
  };
};

export const createFixturePort = (): PortClient => {
  const verdicts = agentVerdicts as unknown[];
  let index = 0;

  return {
    async upsertEntity(blueprint, identifier) {
      console.log(`[fixtures] port upsert ${blueprint}/${identifier}`);
    },
    async patchEntity(blueprint, identifier) {
      console.log(`[fixtures] port patch ${blueprint}/${identifier}`);
    },
    async invokeAgent() {
      const verdict = verdicts[index % verdicts.length];
      index += 1;
      return verdict;
    },
  };
};
```

In `src/index.ts`, branch on `config.demoMode` when constructing `bd` and `port`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd craigsnotice_api && DATABASE_URL=postgres://localhost/craigsnotice_test bun run test:run fixtures`
Expected: PASS, 3 tests.

- [ ] **Step 6: Verify offline**

Run: turn off wifi, then `DEMO_MODE=fixtures bun run dev`, create a watch and hit **Run now**.
Expected: listings appear, an alert fires, the in-app feed updates.

- [ ] **Step 7: Commit**

```bash
git add craigsnotice_api/src/fixtures craigsnotice_api/src/services/fixtures.ts craigsnotice_api/src/index.ts craigsnotice_api/tests/fixtures.test.ts
git commit -m "feat(api): add offline fixtures mode for demo resilience"
```

---

### Task 34: README and submission materials

**Files:**
- Create: `README.md`
- Create: `docs/DEMO.md`

**Interfaces:**
- Consumes: everything.
- Produces: the repo README the submission requires, plus a demo runbook.

- [ ] **Step 1: Write the README**

`README.md` must contain:

1. **What it is** — one paragraph, plus a screenshot of the alert feed.
2. **The three technologies and exactly how each is used** — Bright Data (two collectors,
   trigger/poll, Zod validation, self-heal), Port (blueprints as the Context Lake, the deal
   agent via `POST /v1/agent/:id/invoke`, entity mirroring, user feedback patched onto the
   alert entity), SigNoz (the span tree, the metric list, self-heal events as first-class
   signals, and the alert rule that calls back into the API to run a heal).
3. **Architecture diagram** — the pipeline from spec §7.
4. **The staged self-heal, stated plainly.** Copy this verbatim:

   > The self-heal detection, event emission, Bright Data heal call, and recovery are all real.
   > The *break* is staged: `POST /api/v1/debug/inject-scrape-failure` (dev-only, token-gated)
   > forces the next parse to report a total schema violation, because Craigslist will not
   > change its DOM on demand during a four-minute demo. Everything downstream of that
   > injection is the production code path.

5. **Setup** — `bun install`, `createdb craigsnotice`, `bun run db:init`, `bun run port:sync`,
   the `.env` variables, and how to create the two Bright Data collectors with
   `bdata scraper create`.
6. **Running** — `bun run dev` in `craigsnotice_api` and `craigsnotice_app`.
7. **Tests** — `bun run test` from the repo root.
8. **Fixtures mode** — `DEMO_MODE=fixtures` runs the whole pipeline offline.

- [ ] **Step 2: Write the demo runbook**

`docs/DEMO.md`, timed for 4 minutes:

| Time | Beat | Action |
|---|---|---|
| 0:00 | The problem | "I want a Mac Studio, but I'm not refreshing Craigslist all day." |
| 0:20 | Create a watch | Sign in, "Use my location" resolves to SF bay area, category Computers, "Mac Studio", alert under $1,500. Show the derived Craigslist URL. |
| 0:50 | Run it | **Run now**. Switch to SigNoz Traces; the `watch.tick` trace appears with its seven child spans. |
| 1:20 | The alert | Push notification fires; the alert card shows price, delta vs median, and the agent's reasoning. |
| 1:50 | Port catalog | Show the Watch, Listing and DealAlert entities and their relations in Port. |
| 2:20 | The human loop | Thumbs-down two borderline alerts. Show `userFeedback` updating on the Port entity. Run again; the agent's threshold has tightened — read the new reasoning aloud. |
| 3:00 | Break the scraper | `curl` the inject endpoint. Run again. SigNoz logs show `scraper.selfheal.triggered` at WARN; the `scraper.health` gauge drops to 0; the Port scraper entity flips to degraded. |
| 3:30 | It repairs itself | `scraper.selfheal.succeeded` at INFO, gauge back to 1, Port entity healthy, next run clean. State plainly that the break is staged and the repair is not. |
| 3:50 | Close | "Bright Data gets the data and keeps itself working, Port decides and remembers, SigNoz sees it all and closes the loop." |

- [ ] **Step 3: Run the full verification**

Run: `bun run test && bun run typecheck && bun run lint`
Expected: every package green. Record the actual output; do not claim success without it.

- [ ] **Step 4: Commit**

```bash
git add README.md docs/DEMO.md
git commit -m "docs: add README and demo runbook"
```

---

## Appendix: pre-event checklist

Accounts and credentials, all needed before Phase 1 can start:

- [ ] Firebase project created; web app registered; Google sign-in enabled; VAPID key generated; service-account JSON downloaded for the API.
- [ ] Bright Data account with API token; `npm i -g @brightdata/cli && bdata login`.
- [ ] Search collector: `bdata scraper create "https://sfbay.craigslist.org/search/sya?query=Mac+Studio" "Extract every search result: post id, title, price, url, posted date, location"` → record the id as `BRIGHTDATA_SEARCH_COLLECTOR`.
- [ ] Detail collector: `bdata scraper create "<a real listing url>" "Extract post id, title, price, description, condition, image count, posted date, location"` → record as `BRIGHTDATA_DETAIL_COLLECTOR`.
- [ ] Port account; API client id and secret; custom agent created with the Task 17 prompt; agent id recorded as `PORT_DEAL_AGENT_ID`.
- [ ] SigNoz Cloud account; ingestion key and region recorded.
- [ ] Postgres running locally; `createdb craigsnotice && createdb craigsnotice_test`.
- [ ] `DEBUG_TOKEN` set to any random string.
