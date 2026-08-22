import { useCallback, useMemo, useState } from "react";
import { getSite, type CreateWatchInput, type Site } from "@craigsnotice/types";
import { useWatchDraftStore } from "@craigsnotice/lib";
import { Button, Label, Text } from "@sudobility/components";
import { LocationPicker } from "./LocationPicker";
import { CategoryPicker } from "./CategoryPicker";

export interface WatchFormProps {
  onSubmit(input: CreateWatchInput): void;
  pending?: boolean;
}

export const WatchForm = ({ onSubmit, pending = false }: WatchFormProps) => {
  /**
   * The draft lives in a persisted store, so location, category, what you are
   * looking for and the target price all survive a reload. Only the query is
   * cleared after a successful create — the rest is almost always reused for
   * the next watch.
   */
  const draft = useWatchDraftStore();
  const [error, setError] = useState<string | null>(null);

  const site = useMemo(
    () => (draft.siteCode ? (getSite(draft.siteCode) ?? null) : null),
    [draft.siteCode]
  );

  const setSite = useCallback(
    (next: Site | null) => draft.set("siteCode", next?.code ?? ""),
    [draft]
  );

  const categoryCode = draft.categoryCode;
  const query = draft.query;
  const targetPrice = draft.targetPrice;

  const setCategoryCode = (code: string): void =>
    draft.set("categoryCode", code);
  const setQuery = (q: string): void => draft.set("query", q);
  const setTargetPrice = (p: string): void => draft.set("targetPrice", p);

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

    // Location and category are deliberately kept — the next watch is usually
    // in the same place and section.
    draft.set("query", "");
  };

  return (
    <form
      className="panel"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="rule-double bg-ink px-4 py-2.5">
        <span className="eyebrow text-paper">
          New watch
        </span>
      </div>

      <div className="space-y-5 p-4">
        <LocationPicker value={site} onChange={setSite} />
        <CategoryPicker value={categoryCode} onChange={setCategoryCode} />

        <div>
          <Label htmlFor="query" className="eyebrow mb-2 block">
            Looking for
          </Label>
          <input
            id="query"
            type="text"
            value={query}
            placeholder="Mac Studio"
            onChange={(e) => setQuery(e.target.value)}
            className="field"
          />
        </div>

        <div>
          <Label htmlFor="targetPrice" className="eyebrow mb-2 block">
            Alert me under
          </Label>
          <div className="flex items-stretch">
            <span className="flex items-center border border-r-0 border-rule px-3 text-ink-muted">
              $
            </span>
            <input
              id="targetPrice"
              type="number"
              min="0"
              value={targetPrice}
              placeholder="optional"
              onChange={(e) => setTargetPrice(e.target.value)}
              className="field figure"
            />
          </div>
        </div>

        {error && (
          <Text size="sm" className="block font-medium text-accent">
            {error}
          </Text>
        )}

        <Button
          type="submit"
          disabled={pending}
          className="eyebrow w-full border border-rule/50 bg-ink py-3 text-paper hover:bg-accent disabled:opacity-40"
        >
          {pending ? "Creating…" : "Create watch"}
        </Button>
      </div>
    </form>
  );
};
