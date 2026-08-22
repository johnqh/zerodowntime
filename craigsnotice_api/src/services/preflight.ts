/**
 * Self-healing has no REST surface — POST /dca/collector/:id/heal 404s — so it
 * shells out to the Bright Data CLI. If `bdata` is not on PATH the failure is
 * silent until a scraper actually breaks, and then it surfaces as
 * scraper.selfheal.failed mid-demo. Check at boot instead.
 */
export interface BinaryProbe {
  (binary: string): Promise<boolean>;
}

export const spawnProbe: BinaryProbe = async (binary) => {
  try {
    const proc = Bun.spawn([binary, "--version"], {
      stdout: "ignore",
      stderr: "ignore",
    });
    return (await proc.exited) === 0;
  } catch {
    return false;
  }
};

export interface PreflightResult {
  ok: boolean;
  warnings: string[];
}

export const preflight = async (
  opts: { fixtures: boolean; probe?: BinaryProbe } = { fixtures: false }
): Promise<PreflightResult> => {
  const warnings: string[] = [];
  const probe = opts.probe ?? spawnProbe;

  // Fixtures mode never calls out, so the CLI is irrelevant there.
  if (!opts.fixtures && !(await probe("bdata"))) {
    warnings.push(
      "bdata CLI not found on PATH — self-healing will fail when a scraper " +
        "breaks. Install it with `npm i -g @brightdata/cli` and run " +
        "`bdata login`. Everything else works without it."
    );
  }

  return { ok: warnings.length === 0, warnings };
};
