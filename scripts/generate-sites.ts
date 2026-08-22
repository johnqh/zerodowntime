/**
 * Regenerates craigsnotice_types/src/craigslist/sites.json from Craigslist's own
 * reference API, which is the same source their sites map uses. Run it once; the
 * committed JSON is the source of truth thereafter, because the app must work
 * offline in DEMO_MODE=fixtures.
 *
 *   bun run scripts/generate-sites.ts
 */
const AREAS_URL = "https://reference.craigslist.org/Areas";

interface RawSubArea {
  Abbreviation: string;
  Description: string;
  ShortDescription: string;
}

interface RawArea {
  Hostname: string;
  Description: string;
  ShortDescription: string;
  Region: string | null;
  Country: string;
  Latitude: number;
  Longitude: number;
  SubAreas?: RawSubArea[];
}

const res = await fetch(AREAS_URL, {
  headers: { "User-Agent": "craigsnotice/0.1 (hackathon project)" },
});
if (!res.ok) throw new Error(`Areas API returned ${res.status}`);

const areas = (await res.json()) as RawArea[];

const sites = areas
  .filter((a) => a.Country === "US")
  // Continental-US bounding box plus Alaska and Hawaii; excludes Pacific
  // territories whose positive longitudes would break nearest-site distance math.
  .filter((a) => a.Longitude < -64 && a.Longitude > -180)
  .map((a) => ({
    code: a.Hostname,
    name: a.Description,
    state: a.Region ?? "",
    lat: a.Latitude,
    lng: a.Longitude,
    subareas: (a.SubAreas ?? []).map((s) => ({
      code: s.Abbreviation,
      name: s.Description,
    })),
  }))
  .sort((a, b) => a.code.localeCompare(b.code));

const seen = new Set<string>();
const problems: string[] = [];
for (const s of sites) {
  if (seen.has(s.code)) problems.push(`duplicate site code: ${s.code}`);
  seen.add(s.code);
  if (!s.name.trim()) problems.push(`${s.code}: empty name`);
  if (!s.state.trim()) problems.push(`${s.code}: empty state`);
  if (!Number.isFinite(s.lat) || !Number.isFinite(s.lng)) {
    problems.push(`${s.code}: missing coordinates`);
  }
}
for (const p of problems) console.error(p);

const out = new URL(
  "../craigsnotice_types/src/craigslist/sites.json",
  import.meta.url
).pathname;
await Bun.write(out, `${JSON.stringify(sites, null, 2)}\n`);

console.log(`wrote ${sites.length} US sites to ${out}`);
console.log(`${problems.length} problems`);
