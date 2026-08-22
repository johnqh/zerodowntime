import { useMemo, useState } from "react";
import { SITES, type Site } from "@craigsnotice/types";
import { useGeoSite } from "@craigsnotice/lib";
import { Label, Text } from "@sudobility/components";

const MAX_RESULTS = 50;

export interface LocationPickerProps {
  value: Site | null;
  onChange(site: Site | null): void;
}

/**
 * A plain select over 413 sites is unusable, so this filters as you type.
 * "Use my location" resolves coordinates to the nearest site.
 */
export const LocationPicker = ({ value, onChange }: LocationPickerProps) => {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const geo = useGeoSite();

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === "") return SITES.slice(0, MAX_RESULTS);
    return SITES.filter(
      (s) => s.name.toLowerCase().includes(q) || s.state.toLowerCase() === q
    ).slice(0, MAX_RESULTS);
  }, [query]);

  const pick = (site: Site): void => {
    onChange(site);
    setQuery(site.name);
    setOpen(false);
  };

  if (geo.status === "resolved" && geo.site && !value) pick(geo.site);

  return (
    <div className="relative">
      <Label htmlFor="location" className="eyebrow mb-2 block">
        Location
      </Label>

      <div className="flex">
        <input
          id="location"
          type="text"
          autoComplete="off"
          value={query}
          placeholder="Search 413 Craigslist cities"
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            if (value) onChange(null);
          }}
          onFocus={() => setOpen(true)}
          className="field border-r-0"
        />
        <button
          type="button"
          onClick={geo.locate}
          className="eyebrow whitespace-nowrap border border-rule/50 px-3 hover:bg-ink hover:text-paper"
        >
          {geo.status === "locating" ? "Locating" : "Locate me"}
        </button>
      </div>

      {(geo.status === "denied" || geo.status === "unsupported") && (
        <Text size="sm" className="mt-2 block text-ink-muted">
          {geo.status === "denied"
            ? "Location permission denied — pick a city above."
            : "This browser cannot share location — pick a city above."}
        </Text>
      )}

      {open && (
        <ul className="absolute z-10 mt-px max-h-64 w-full overflow-auto border border-rule/50 bg-paper shadow-card">
          {matches.length === 0 ? (
            <li className="px-3 py-2 text-sm text-ink-muted">
              No matching cities
            </li>
          ) : (
            matches.map((site) => (
              <li key={site.code} className="border-b border-rule/15 last:border-0">
                <button
                  type="button"
                  onClick={() => pick(site)}
                  className="flex w-full items-baseline justify-between px-3 py-2 text-left text-sm hover:bg-ink hover:text-paper"
                >
                  <span>{site.name}</span>
                  <span className="text-micro uppercase tracking-caps opacity-60">
                    {site.state}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
};
