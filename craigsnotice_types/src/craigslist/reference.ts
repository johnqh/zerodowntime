import sitesJson from "./sites.json" with { type: "json" };
import categoriesJson from "./categories.json" with { type: "json" };

export interface Subarea {
  code: string;
  name: string;
}

export interface Site {
  code: string;
  name: string;
  state: string;
  lat: number;
  lng: number;
  subareas: Subarea[];
}

export interface Category {
  code: string;
  label: string;
}

export const SITES: Site[] = sitesJson as Site[];
export const CATEGORIES: Category[] = categoriesJson as Category[];

const siteIndex = new Map(SITES.map((s) => [s.code, s]));
const categoryIndex = new Map(CATEGORIES.map((c) => [c.code, c]));

export const getSite = (code: string): Site | undefined => siteIndex.get(code);

export const getCategory = (code: string): Category | undefined =>
  categoryIndex.get(code);
