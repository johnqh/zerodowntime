import { useState } from "react";
import type { CreateWatchInput, Site } from "@craigsnotice/types";
import { LocationPicker } from "./LocationPicker";
import { CategoryPicker } from "./CategoryPicker";

export interface WatchFormProps {
  onSubmit(input: CreateWatchInput): void;
  pending?: boolean;
}

export const WatchForm = ({ onSubmit, pending = false }: WatchFormProps) => {
  const [site, setSite] = useState<Site | null>(null);
  const [categoryCode, setCategoryCode] = useState("sss");
  const [query, setQuery] = useState("");
  const [targetPrice, setTargetPrice] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = (): void => {
    if (!site) {
      setError("Choose a location");
      return;
    }
    if (query.trim() === "") {
      setError("Say what you are looking for");
      return;
    }
    setError(null);

    const price = Number(targetPrice);
    onSubmit({
      siteCode: site.code,
      categoryCode,
      query: query.trim(),
      intervalSec: 300,
      ...(targetPrice.trim() !== "" && Number.isFinite(price)
        ? { targetPrice: price }
        : {}),
    });
  };

  return (
    <form
      className="space-y-4 rounded-xl border border-slate-200 bg-white p-5"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <LocationPicker value={site} onChange={setSite} />
      <CategoryPicker value={categoryCode} onChange={setCategoryCode} />

      <div>
        <label
          htmlFor="query"
          className="mb-1 block text-sm font-medium text-slate-700"
        >
          Looking for
        </label>
        <input
          id="query"
          type="text"
          value={query}
          placeholder="Mac Studio"
          onChange={(e) => setQuery(e.target.value)}
          className="w-full rounded-md border border-slate-300 px-3 py-2 outline-none focus:border-slate-900"
        />
      </div>

      <div>
        <label
          htmlFor="targetPrice"
          className="mb-1 block text-sm font-medium text-slate-700"
        >
          Alert me under $ (optional)
        </label>
        <input
          id="targetPrice"
          type="number"
          min="0"
          value={targetPrice}
          placeholder="1200"
          onChange={(e) => setTargetPrice(e.target.value)}
          className="w-full rounded-md border border-slate-300 px-3 py-2 outline-none focus:border-slate-900"
        />
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-slate-900 px-4 py-2 font-medium text-white transition hover:bg-slate-700 disabled:opacity-50"
      >
        {pending ? "Creating…" : "Create watch"}
      </button>
    </form>
  );
};
