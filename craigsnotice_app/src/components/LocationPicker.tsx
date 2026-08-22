import { useMemo, useState } from "react";
import { SITES, type Site } from "@craigsnotice/types";
import { useGeoSite } from "@craigsnotice/lib";

const MAX_RESULTS = 50;

export interface LocationPickerProps {
  value: Site | null;
  onChange(site: Site | null): void;
}

/**
 * A plain <select> over ~400 sites is unusable, so this is a filtering
 * combobox. "Use my location" resolves coordinates to the nearest site.
 */
export const LocationPicker = ({ value, onChange }: LocationPickerProps) => {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const geo = useGeoSite();

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === "") return SITES.slice(0, MAX_RESULTS);
    return SITES.filter(
      (s) =>
        s.name.toLowerCase().includes(q) || s.state.toLowerCase() === q
    ).slice(0, MAX_RESULTS);
  }, [query]);

  const pick = (site: Site): void => {
    onChange(site);
    setQuery(site.name);
    setOpen(false);
  };

  if (geo.status === "resolved" && geo.site && !value) {
    pick(geo.site);
  }

  return (
    <div className="relative">
      <label
        htmlFor="location"
        className="mb-1 block text-sm font-medium text-slate-700"
      >
        Location
      </label>

      <div className="flex gap-2">
        <input
          id="location"
          type="text"
          autoComplete="off"
          value={query}
          placeholder="Search cities…"
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            if (value) onChange(null);
          }}
          onFocus={() => setOpen(true)}
          className="w-full rounded-md border border-slate-300 px-3 py-2 outline-none focus:border-slate-900"
        />
        <button
          type="button"
          onClick={geo.locate}
          className="whitespace-nowrap rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
        >
          {geo.status === "locating" ? "Locating…" : "Use my location"}
        </button>
      </div>

      {geo.status === "denied" && (
        <p className="mt-1 text-sm text-amber-700">
          Location permission denied — pick a city above.
        </p>
      )}
      {geo.status === "unsupported" && (
        <p className="mt-1 text-sm text-amber-700">
          This browser cannot share location — pick a city above.
        </p>
      )}

      {open && (
        <ul className="absolute z-10 mt-1 max-h-64 w-full overflow-auto rounded-md border border-slate-200 bg-white shadow-lg">
          {matches.length === 0 ? (
            <li className="px-3 py-2 text-sm text-slate-500">
              No matching cities
            </li>
          ) : (
            matches.map((site) => (
              <li key={site.code}>
                <button
                  type="button"
                  onClick={() => pick(site)}
                  className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-100"
                >
                  {site.name}
                  <span className="ml-2 text-slate-400">{site.state}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
};
