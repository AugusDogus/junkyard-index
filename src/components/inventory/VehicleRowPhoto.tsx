"use client";

import { useProxiedPhoto } from "~/hooks/use-proxied-photo";
import { ProxiedPhoto } from "~/lib/proxied-photo";
import wsrvLoader from "~/lib/wsrvLoader";

/** Isolates photo failure handling from the server-rendered inventory row. */
export function VehicleRowPhoto({ src }: { src: string }) {
  return (
    <div className="border-rule-strong bg-paper-2 relative aspect-[4/3] w-24 shrink-0 self-start overflow-hidden border sm:w-[8.25rem]">
      <Photo key={src} src={src} />
    </div>
  );
}

function Photo({ src }: { src: string }) {
  const proxyUrl = wsrvLoader({ src, width: 256 });
  const proxied = proxyUrl !== src;
  const { photo, ref, onLoad, onError } = useProxiedPhoto({
    proxied,
    eager: false,
  });
  if (photo.kind === "failed") {
    return (
      <span className="text-ink-3 absolute inset-0 grid place-items-center px-1 text-center text-xs">
        No photo
      </span>
    );
  }
  // The shimmer sits behind the photo, which covers it once it paints,
  // even before hydration.
  return (
    <>
      {ProxiedPhoto.loading(photo) && (
        <span
          aria-hidden="true"
          data-photo-loading
          className="bg-rule/60 absolute inset-0 animate-pulse"
        />
      )}
      <img
        key={photo.kind}
        ref={ref}
        src={photo.kind === "proxy" ? proxyUrl : src}
        alt=""
        width={128}
        height={96}
        loading="lazy"
        decoding="async"
        // Only a fallback from the proxy hides the referrer from the yard.
        referrerPolicy={
          proxied && photo.kind === "direct" ? "no-referrer" : undefined
        }
        className="relative size-full object-cover"
        onLoad={onLoad}
        onError={onError}
      />
    </>
  );
}
