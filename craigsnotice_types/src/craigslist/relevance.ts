/**
 * A cheap, local relevance gate that runs before the agent.
 *
 * Craigslist category search is extremely loose: a search for "Mac mini" in
 * the computers section returns Dell XPS laptops, HP Spectres, projectors and
 * monitors. Sending all of those to the agent is slow and burns a metered
 * quota to be told the obvious.
 *
 * This is deliberately a *pre*-filter, not the decision. It only rejects
 * listings whose titles cannot plausibly be the wanted item. Everything that
 * passes still goes to the agent, which makes the real call.
 */
const STOPWORDS = new Set([
  "a",
  "an",
  "the",
  "for",
  "with",
  "and",
  "or",
  "of",
  "in",
  "on",
  "to",
  "new",
  "used",
  "like",
]);

export const significantTokens = (text: string): string[] =>
  text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w));

/**
 * True when every significant token of the query appears in the title. A
 * query token also matches a longer title word that starts with it, so
 * "mini" matches "mini's" and "macbook" is not matched by "mac".
 */
export const titleCouldMatchQuery = (
  query: string,
  title: string
): boolean => {
  const wanted = significantTokens(query);
  if (wanted.length === 0) return true;

  const present = significantTokens(title);
  if (present.length === 0) return false;

  return wanted.every((token) =>
    present.some(
      (word) => word === token || (token.length > 3 && word.startsWith(token))
    )
  );
};
