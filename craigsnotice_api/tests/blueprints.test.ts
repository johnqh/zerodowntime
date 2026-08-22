import { describe, it, expect } from "vitest";
import { loadBlueprints, BLUEPRINT_DIR } from "../scripts/sync-blueprints";

describe("port blueprints", () => {
  const blueprints = loadBlueprints(BLUEPRINT_DIR);

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
        expect(
          ids.has(rel.target),
          `${b.identifier}.${name} targets unknown ${rel.target}`
        ).toBe(true);
      }
    }
  });

  it("gives the deal alert a userFeedback property so the feedback loop is visible in Port", () => {
    const alert = blueprints.find(
      (b) => b.identifier === "craigsnotice_deal_alert"
    );
    expect(alert!.schema.properties.userFeedback).toBeDefined();
  });
});
