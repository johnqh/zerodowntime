import { DealImage } from "./DealImage";

export interface DealImageStackProps {
  images: string[];
  total: number;
}

/** Overlapping thumbnails, like photos laid out on a desk. */
const MAX_THUMBS = 4;

export const DealImageStack = ({ images, total }: DealImageStackProps) => {
  if (total === 0) {
    return <span className="eyebrow text-ink-faint">No deals yet</span>;
  }

  const shown = images.slice(0, MAX_THUMBS);
  const overflow = total - shown.length;

  return (
    <div className="flex items-center gap-3">
      <div className="flex">
        {shown.map((src, i) => (
          <div
            key={src}
            className="-ml-3 first:ml-0"
            style={{ zIndex: shown.length - i }}
          >
            <DealImage
              src={src}
              alt=""
              className="h-12 w-12 shadow-card ring-2 ring-paper"
            />
          </div>
        ))}
        {shown.length === 0 && (
          <DealImage src={null} alt="" className="h-12 w-12" />
        )}
      </div>

      <span className="eyebrow text-ink-muted">
        {total} {total === 1 ? "deal" : "deals"}
        {overflow > 0 && shown.length > 0 && ` · +${overflow}`}
      </span>
    </div>
  );
};
