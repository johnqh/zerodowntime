import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { createPortClient, type Blueprint } from "../src/services/port/client";

export const loadBlueprints = (dir: string): Blueprint[] =>
  readdirSync(dir)
    .filter((f) => f.endsWith(".yaml"))
    .map((f) => parse(readFileSync(join(dir, f), "utf8")) as Blueprint)
    .sort((a, b) => a.identifier.localeCompare(b.identifier));

export const BLUEPRINT_DIR = new URL("../../port/blueprints", import.meta.url)
  .pathname;

if (import.meta.main) {
  const client = createPortClient({
    clientId: process.env.PORT_CLIENT_ID!,
    clientSecret: process.env.PORT_CLIENT_SECRET!,
  });

  for (const bp of loadBlueprints(BLUEPRINT_DIR)) {
    await client.upsertBlueprint(bp);
    console.log(`synced blueprint ${bp.identifier}`);
  }
}
