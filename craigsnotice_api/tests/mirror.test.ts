import { describe, it, expect } from "vitest";
import { createFakePort } from "../src/services/port/fake";
import {
  mirrorWatch,
  mirrorScrapeRun,
  safeMirror,
} from "../src/services/port/mirror";

const watch = {
  id: "w1",
  siteCode: "sfbay",
  subarea: null,
  categoryCode: "sya",
  query: "Mac Studio",
  targetPrice: "1500",
  intervalSec: 300,
  status: "active",
  searchUrl: "https://sfbay.craigslist.org/search/sya?query=Mac+Studio",
};

describe("mirrorWatch", () => {
  it("upserts the watch with its query as the title", async () => {
    const port = createFakePort();
    await mirrorWatch(port, watch, "demo@x.dev");

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
      id: "r1",
      watchId: "w1",
      scraperConfigId: "s1",
      snapshotId: "snap_1",
      status: "ready",
      rowCount: 12,
      violationCount: 0,
      durationMs: 41000,
    });

    const u = port.upserts[0]!;
    expect(u.blueprint).toBe("craigsnotice_scrape_run");
    expect(u.relations).toEqual({ watch: "w1", scraper: "s1" });
    expect(u.properties.rowCount).toBe(12);
  });
});

describe("safeMirror", () => {
  it("swallows a mirror failure so the pipeline continues", async () => {
    await expect(
      safeMirror(async () => {
        throw new Error("port is down");
      })
    ).resolves.toBeUndefined();
  });

  it("runs the mirror when Port is healthy", async () => {
    let ran = false;
    await safeMirror(async () => {
      ran = true;
    });
    expect(ran).toBe(true);
  });
});
