import { useState } from "react";

export interface DealImageProps {
  src: string | null;
  alt: string;
  className?: string;
}

/**
 * Craigslist thumbnails 404 once a post is taken down, and some listings have
 * no photo at all, so a missing image must degrade to a printed placeholder
 * rather than a broken-image icon.
 */
export const DealImage = ({ src, alt, className = "" }: DealImageProps) => {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <div
        className={`flex items-center justify-center border border-rule/30 bg-paper-deep ${className}`}
        aria-label="No photo"
      >
        <span className="eyebrow text-ink-faint">No photo</span>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      onError={() => setFailed(true)}
      className={`border border-rule/30 bg-paper-deep object-cover ${className}`}
    />
  );
};
