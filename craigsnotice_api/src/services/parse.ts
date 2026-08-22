import type { ZodType } from "zod";

export interface ParseResult<T> {
  rows: T[];
  violations: number;
  total: number;
  violationRate: number;
  /** First Zod message, used to make the self-heal prompt specific. */
  sampleViolation: string | null;
}

const INJECTED_VIOLATION =
  "injected failure: post_id: Required; price: Required";

/**
 * Validates every scraped row. Rows that fail are dropped, not repaired — a
 * high violation rate means the scraper is broken, not that the data is bad.
 *
 * `forceFailure` is the staged-break path used by the demo's self-heal trigger;
 * it treats every row as a violation so the real detection chain runs.
 */
export const parseRows = <T>(
  raw: unknown[],
  schema: ZodType<T>,
  forceFailure = false
): ParseResult<T> => {
  if (forceFailure) {
    return {
      rows: [],
      violations: raw.length,
      total: raw.length,
      violationRate: raw.length === 0 ? 1 : 1,
      sampleViolation: INJECTED_VIOLATION,
    };
  }

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
export const isDegraded = (rate: number, threshold: number): boolean =>
  rate > threshold;
