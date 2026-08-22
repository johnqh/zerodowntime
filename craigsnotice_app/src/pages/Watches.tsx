import { Link } from "react-router-dom";
import { useCreateWatch, useRunWatch, useWatches } from "@craigsnotice/client";
import { WatchForm } from "../components/WatchForm";
import { useClientContext } from "../hooks/useClientContext";

export const Watches = () => {
  const ctx = useClientContext();
  const watches = useWatches(ctx);
  const create = useCreateWatch(ctx);
  const run = useRunWatch(ctx);

  return (
    <div className="mx-auto grid max-w-5xl gap-8 px-6 py-8 md:grid-cols-[360px_1fr]">
      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-900">New watch</h2>
        <WatchForm
          pending={create.isPending}
          onSubmit={(input) => create.mutate(input)}
        />
        {create.isError && (
          <p className="mt-2 text-sm text-red-600">{create.error.message}</p>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-900">Watches</h2>

        {watches.isLoading && <p className="text-slate-500">Loading…</p>}
        {watches.data?.length === 0 && (
          <p className="text-slate-500">
            No watches yet. Create one and we will start hunting.
          </p>
        )}

        <ul className="space-y-3">
          {watches.data?.map((w) => (
            <li
              key={w.id}
              className="rounded-xl border border-slate-200 bg-white p-4"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <Link
                    to={`/watches/${w.id}`}
                    className="font-medium text-slate-900 hover:underline"
                  >
                    {w.query}
                  </Link>
                  <p className="mt-1 truncate text-sm text-slate-500">
                    {w.siteCode} · {w.categoryCode}
                    {w.targetPrice !== null && ` · under $${w.targetPrice}`}
                  </p>
                  <a
                    href={w.searchUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 block truncate text-xs text-slate-400 hover:underline"
                  >
                    {w.searchUrl}
                  </a>
                </div>

                <button
                  type="button"
                  onClick={() => run.mutate(w.id)}
                  disabled={run.isPending}
                  className="shrink-0 rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
                >
                  {run.isPending ? "Running…" : "Run now"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
};

export default Watches;
