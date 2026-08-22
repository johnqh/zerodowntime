import { getCategory, getSite } from "./reference";

export class InvalidWatchTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidWatchTargetError";
  }
}

export interface SearchUrlInput {
  siteCode: string;
  subarea?: string | undefined;
  categoryCode: string;
  query: string;
}

/**
 * Builds the subdomain search form, e.g.
 *   https://sfbay.craigslist.org/search/sfc/sya?query=Mac+Studio
 *
 * Craigslist canonicalises this itself with a 301 to
 *   https://www.craigslist.org/search/subarea/sfc?cat=sya&query=Mac%20Studio
 * preserving subarea, category and query, so scrapers may follow one redirect.
 */
export const buildCraigslistSearchUrl = (input: SearchUrlInput): string => {
  const site = getSite(input.siteCode);
  if (!site) {
    throw new InvalidWatchTargetError(`unknown site: ${input.siteCode}`);
  }

  if (!getCategory(input.categoryCode)) {
    throw new InvalidWatchTargetError(
      `unknown category: ${input.categoryCode}`
    );
  }

  if (input.subarea && !site.subareas.some((a) => a.code === input.subarea)) {
    throw new InvalidWatchTargetError(
      `subarea ${input.subarea} does not belong to site ${site.code}`
    );
  }

  const query = input.query.trim().replace(/\s+/g, " ");
  if (query === "") {
    throw new InvalidWatchTargetError("query must not be empty");
  }

  const path = input.subarea
    ? `${input.subarea}/${input.categoryCode}`
    : input.categoryCode;

  const params = new URLSearchParams({ query });
  return `https://${site.code}.craigslist.org/search/${path}?${params.toString()}`;
};
