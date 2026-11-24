/**
 * Which copy of a vehicle photo to show. The resizing proxy can take many
 * seconds on a cold photo, or fail, so a slow or failed proxy falls back to
 * the yard's own URL, and only a failed origin shows the placeholder.
 */
export type ProxiedPhoto =
  | { kind: "proxy"; loaded: boolean }
  | { kind: "direct"; loaded: boolean }
  | { kind: "failed" };

export type ProxiedPhotoEvent = "load" | "error" | "slow";

/** How long a proxied photo may load before the origin is tried instead. */
const SLOW_MS = 4000;

export const ProxiedPhoto = {
  SLOW_MS,

  /** Photos whose host bypasses the proxy start on the origin. */
  initial(proxied: boolean): ProxiedPhoto {
    return { kind: proxied ? "proxy" : "direct", loaded: false };
  },

  next(photo: ProxiedPhoto, event: ProxiedPhotoEvent): ProxiedPhoto {
    if (photo.kind === "failed") return photo;
    if (event === "load") return { kind: photo.kind, loaded: true };
    if (event === "error")
      return photo.kind === "proxy"
        ? { kind: "direct", loaded: false }
        : { kind: "failed" };
    return photo.kind === "proxy" && !photo.loaded
      ? { kind: "direct", loaded: false }
      : photo;
  },

  loading(photo: ProxiedPhoto): boolean {
    return photo.kind !== "failed" && !photo.loaded;
  },
} as const;
