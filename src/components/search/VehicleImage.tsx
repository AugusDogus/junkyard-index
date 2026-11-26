"use client";

import { ImageOff } from "lucide-react";
import Image from "next/image";
import type { ReactNode } from "react";
import { useProxiedPhoto } from "~/hooks/use-proxied-photo";
import { ProxiedPhoto } from "~/lib/proxied-photo";
import { cn } from "~/lib/utils";
import wsrvLoader from "~/lib/wsrvLoader";

type VehicleImageProps = {
  /** The vehicle's photo URL; null or blank when the yard sent none. */
  src: string | null;
  alt: string;
  sizes: string;
  priority?: boolean;
  /** The picture box around the photo and its loading shimmer. */
  frame: (photo: ReactNode) => ReactNode;
  /**
   * Shown in place of the whole picture box when there is no photo, or when
   * it fails at the proxy and at the yard. Usually a `NoPhotoStrip`.
   */
  missing: ReactNode;
};

/**
 * A vehicle photo inside its card's picture box. A card keeps the box only
 * while it has a photo to show: with none, or once both copies fail, the box
 * gives way to `missing`, so a failed photo looks like a listing without one.
 */
export function VehicleImage({ src, ...props }: VehicleImageProps) {
  const url = src?.trim();
  if (!url) return props.missing;
  return <Photo key={url} src={url} {...props} />;
}

function Photo({
  src,
  alt,
  sizes,
  priority = false,
  frame,
  missing,
}: VehicleImageProps & { src: string }) {
  // The loader returns a bypassed host's URL unchanged.
  const proxied = wsrvLoader({ src, width: 1 }) !== src;
  const { photo, ref, onLoad, onError } = useProxiedPhoto({
    proxied,
    eager: priority,
  });

  if (photo.kind === "failed") return missing;

  // The shimmer sits behind the photo, which covers it once it paints.
  return frame(
    <>
      {ProxiedPhoto.loading(photo) && (
        <span
          aria-hidden="true"
          data-photo-loading
          className="bg-muted absolute inset-0 animate-pulse"
        />
      )}
      {photo.kind === "proxy" ? (
        <Image
          ref={ref}
          priority={priority}
          loading={priority ? "eager" : "lazy"}
          fetchPriority={priority ? "high" : "auto"}
          loader={wsrvLoader}
          src={src}
          alt={alt}
          fill
          className="object-cover"
          sizes={sizes}
          onLoad={onLoad}
          onError={onError}
        />
      ) : (
        <img
          ref={ref}
          src={src}
          alt={alt}
          className="absolute inset-0 h-full w-full object-cover"
          loading={priority ? "eager" : "lazy"}
          fetchPriority={priority ? "high" : "auto"}
          decoding="async"
          // Only a fallback from the proxy hides the referrer from the yard.
          referrerPolicy={proxied ? "no-referrer" : undefined}
          onLoad={onLoad}
          onError={onError}
        />
      )}
    </>,
  );
}

const STRIP_SURFACE = {
  paper: { strip: "border-rule bg-paper-2 text-ink-3", stock: "text-ink-2" },
  board: {
    strip: "border-board-rule bg-board-2 text-board-muted",
    stock: "text-board-ink",
  },
} as const;

/**
 * The slim strip a vehicle card shows instead of its picture box when it has
 * no photo. About a fifth of listings have none, and more fail to load, so a
 * grid of them stays compact rather than a wall of empty boxes.
 */
export function NoPhotoStrip({
  stockNumber,
  surface = "paper",
}: {
  /** Shown at the strip's end, where the badge sits on a photo. */
  stockNumber?: string | null;
  surface?: keyof typeof STRIP_SURFACE;
}) {
  const colours = STRIP_SURFACE[surface];
  return (
    <div
      className={cn(
        "flex min-h-9 items-center justify-between gap-3 border-b px-3 py-1.5 text-xs sm:px-4",
        colours.strip,
      )}
    >
      <span className="flex items-center gap-1.5">
        <ImageOff aria-hidden="true" className="size-3.5 shrink-0" />
        No photo
      </span>
      {stockNumber && (
        <span className={cn("truncate tabular-nums", colours.stock)}>
          Stock #{stockNumber}
        </span>
      )}
    </div>
  );
}
