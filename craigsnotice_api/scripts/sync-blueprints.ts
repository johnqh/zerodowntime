import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { createPortClient, type Blueprint } from "../src/services/port/client";

/**
 * Port rejects a blueprint whose relation targets do not exist yet, so
 * dependency order is load-bearing: a plain alphabetical sort puts
 * craigsnotice_deal_alert first and its relations 404.
 */
export const orderByDependency = (blueprints: Blueprint[]): Blueprint[] => {
  const byId = new Map(blueprints.map((b) => [b.identifier, b]));
  const done = new Set<string>();
  const ordered: Blueprint[] = [];

  const visit = (bp: Blueprint, seen: Set<string>): void => {
    if (done.has(bp.identifier)) return;
    if (seen.has(bp.identifier)) {
      throw new Error(`relation cycle at ${bp.identifier}`);
    }
    seen.add(bp.identifier);

    for (const rel of Object.values(bp.relations ?? {})) {
      const target = byId.get(rel.target);
      if (target) visit(target, seen);
    }

    seen.delete(bp.identifier);
    done.add(bp.identifier);
    ordered.push(bp);
  };

  for (const bp of blueprints) visit(bp, new Set());
  return ordered;
};

export const loadBlueprints = (dir: string): Blueprint[] =>
  orderByDependency(
    readdirSync(dir)
      .filter((f) => f.endsWith(".yaml"))
      .map((f) => parse(readFileSync(join(dir, f), "utf8")) as Blueprint)
      .sort((a, b) => a.identifier.localeCompare(b.identifier))
  );

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
