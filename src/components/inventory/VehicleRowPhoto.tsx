"use client";

import { useState } from "react";
import wsrvLoader from "~/lib/wsrvLoader";

/** Isolates photo failure handling from the server-rendered inventory row. */
export function VehicleRowPhoto({ src }: { src: string }) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  return (
    <div className="border-ink bg-paper-2 relative aspect-[4/3] w-24 shrink-0 self-start overflow-hidden border-2 sm:w-[8.25rem]">
      {failedSrc === src ? (
        <span className="text-ink-3 absolute inset-0 grid place-items-center px-1 text-center text-xs">
          No photo
        </span>
      ) : (
        <img
          ref={(image) => {
            // A cached image can fail before React hydrates this row.
            if (image?.complete && image.naturalWidth === 0) setFailedSrc(src);
          }}
          src={wsrvLoader({ src, width: 256 })}
          alt=""
          width={128}
          height={96}
          loading="lazy"
          decoding="async"
          className="size-full object-cover"
          onError={() => setFailedSrc(src)}
        />
      )}
    </div>
  );
}
