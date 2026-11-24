"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ProxiedPhoto, type ProxiedPhotoEvent } from "~/lib/proxied-photo";

/**
 * A vehicle photo's state (see `ProxiedPhoto`), and the ref and handlers for
 * the `<img>` showing it. The slow-proxy timer starts once the photo nears
 * the viewport, or at once for an eager photo. Remount with `key={src}` to
 * start over for a new photo.
 */
export function useProxiedPhoto({
  proxied,
  eager,
}: {
  proxied: boolean;
  eager: boolean;
}) {
  const [photo, setPhoto] = useState(() => ProxiedPhoto.initial(proxied));
  const send = useCallback(
    (event: ProxiedPhotoEvent) =>
      setPhoto((current) => ProxiedPhoto.next(current, event)),
    [],
  );
  const element = useRef<HTMLImageElement | null>(null);
  const waitingOnProxy = photo.kind === "proxy" && !photo.loaded;

  useEffect(() => {
    if (!waitingOnProxy) return;
    let timer: number | undefined;
    const start = () => {
      timer ??= window.setTimeout(() => send("slow"), ProxiedPhoto.SLOW_MS);
    };
    const image = element.current;
    let observer: IntersectionObserver | undefined;
    if (eager || !image || typeof IntersectionObserver === "undefined") {
      start();
    } else {
      observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) {
            start();
            observer?.disconnect();
          }
        },
        { rootMargin: "200px" },
      );
      observer.observe(image);
    }
    return () => {
      observer?.disconnect();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [waitingOnProxy, eager, send]);

  // A photo can finish, or fail, before React hydrates and attaches handlers.
  const ref = useCallback(
    (image: HTMLImageElement | null) => {
      element.current = image;
      if (image?.complete) send(image.naturalWidth === 0 ? "error" : "load");
    },
    [send],
  );

  // Stable handlers, so next/image does not rebuild its ref on each render.
  const onLoad = useCallback(() => send("load"), [send]);
  const onError = useCallback(() => send("error"), [send]);
  return { photo, ref, onLoad, onError } as const;
}
