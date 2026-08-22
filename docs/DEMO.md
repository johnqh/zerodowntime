# CraigsNotice — demo runbook

Four minutes. Three beats: it works, a human tunes it, it repairs itself.

## Before you start

```bash
# one terminal
cd craigsnotice_api && bun run dev

# another
cd craigsnotice_app && bun run dev
```

Have open: the app, the SigNoz **Traces** view, the SigNoz **Logs** view
filtered to `scraper.selfheal`, and the Port catalog.

Set the watch interval long (`WATCH_DEFAULT_INTERVAL_SEC=86400`) so nothing
fires unprompted mid-demo. **Run now** is the trigger.

If you tunnel the API so SigNoz Cloud can reach the heal webhook, set
`SIGNOZ_WEBHOOK_SECRET` and configure SigNoz to send it as `x-signoz-token`.
Without it the `/api/v1/hooks` route is not mounted — deliberately, since it
triggers a billable heal.

Sanity check, ~90 seconds before you present:

```bash
curl -s localhost:8022/health
psql -qtA craigsnotice -c "SELECT kind, health FROM scraper_configs"
```

Both scrapers should read `healthy`.

---

## 0:00 — The problem

> "I want a Mac Studio. I don't want to refresh Craigslist forty times a day."

## 0:20 — Create a watch

Sign in. Click **Use my location** — it resolves your coordinates to *SF bay
area* out of all 413 Craigslist sites. Category **computers**, looking for
**Mac Studio**, alert me under **$2500**.

Point at the derived URL on the watch row:
`https://sfbay.craigslist.org/search/sya?query=Mac+Studio`. That derivation is
a pure, table-tested function — not string-concatenation guesswork.

## 0:50 — Run it

Hit **Run now**. It returns immediately; the work is detached.

Switch to SigNoz → Traces. A `watch.tick` trace appears with its children
nested beneath it: `scrape.trigger`, `scrape.poll`, `scrape.parse`,
`listing.detail.fetch`, `baseline.compute`, `agent.invoke`.

> "One trace per tick. Every alert is traceable back to the scrape that
> produced it."

Call out `scrape.parse` → `scrape.violation_rate = 0`. That number is the
health signal the repair loop watches.

## 1:20 — The alert

The alert lands in the feed (and as a push notification if permission was
granted — the in-app stream is there so the demo can't die on a permission
prompt).

Read the agent's reasoning aloud. From a real run:

> "At $600, the price is ~70% below the baseline median and well under the
> $2500 target, making it attractive for an M2 MacBook Air 512GB, though the
> complete absence of photos and spam keywords in the description warrant
> caution before committing."

> "That's a Port agent, given the listing, a rolling price baseline for this
> watch, and my target price."

## 1:50 — The catalog

Port → the five CraigsNotice blueprints. Open a **Deal Alert** and show its
relations to the Listing and the Watch. Open **Scraper** and show `health:
healthy`.

> "Every blueprint here is version-controlled YAML in the repo. `bun run
> port:sync` rebuilds this catalog from scratch."

## 2:20 — The human in the loop

Thumbs-down the alert. Refresh the Port entity — `userFeedback` is now `bad`.

> "That verdict goes into the next agent invocation. The agent is calibrated
> by the person using it, not by a threshold I hardcoded."

Hit **Run now** again and read the new reasoning — the bar has moved.

## 3:00 — Break the scraper

```bash
curl -X POST localhost:8022/api/v1/debug/inject-scrape-failure \
  -H "x-debug-token: $DEBUG_TOKEN"
```

Say plainly, before anyone asks:

> "I'm staging the break — Craigslist won't change its DOM on cue. Everything
> after this is the real code path."

Hit **Run now**. In SigNoz Logs: `scraper.selfheal.triggered` at **WARN**,
carrying the heal prompt built from the actual Zod violation. The
`scraper.health` gauge drops to 0. In Port, the Scraper entity flips to
**degraded**.

## 3:30 — It repairs itself

`bdata scraper heal` runs against the live Bright Data API with that
plain-language prompt. Then `scraper.selfheal.succeeded` at **INFO**, the
gauge returns to 1, and the Port entity is **healthy** again with
`lastHealedAt` set.

> "Detection, the heal, and the recovery are all real. Only the break was
> staged. And a SigNoz alert on that same gauge can trigger this without me —
> observability doesn't just watch the pipeline, it repairs it."

## 3:50 — Close

> "Bright Data gets the data and keeps itself working. Port decides, and
> remembers what I taught it. SigNoz sees all of it and closes the loop."

---

## If something goes wrong

| Symptom | Do this |
|---|---|
| Wifi is down, or Bright Data is slow | Restart with `DEMO_MODE=fixtures`. Whole pipeline runs offline from a captured live payload. |
| No alerts appear | The agent may have judged everything fairly priced. Lower the target price and **Run now** again. |
| Push notification never arrives | Ignore it — the in-app feed is the primary path and always works. |
| A scraper is stuck `degraded` | `psql craigsnotice -c "UPDATE scraper_configs SET health='healthy', violation_rate=0"` |
