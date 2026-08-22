import { useState } from "react";
import type { CreateWatchInput, Site } from "@craigsnotice/types";
import { Button, Label, Text } from "@sudobility/components";
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
