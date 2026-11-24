"use client";

import Image from "next/image";
import { useProxiedPhoto } from "~/hooks/use-proxied-photo";
import { ProxiedPhoto } from "~/lib/proxied-photo";
import wsrvLoader from "~/lib/wsrvLoader";

type VehicleImageProps = {
  src: string;
  alt: string;
  sizes: string;
  priority?: boolean;
};

export function VehicleImage(props: VehicleImageProps) {
  return <Photo key={props.src} {...props} />;
}

function Photo({ src, alt, sizes, priority = false }: VehicleImageProps) {
  const { photo, ref, onLoad, onError } = useProxiedPhoto({
    // The loader returns a bypassed host's URL unchanged.
    proxied: wsrvLoader({ src, width: 1 }) !== src,
    eager: priority,
  });

  if (photo.kind === "failed") {
    return (
      <div className="bg-muted flex h-full items-center justify-center">
        <div className="text-muted-foreground text-center">
          <p className="text-sm">No Image Available</p>
        </div>
      </div>
    );
  }

  // The shimmer sits behind the photo, which covers it once it paints.
  return (
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
          referrerPolicy="no-referrer"
          onLoad={onLoad}
          onError={onError}
        />
      )}
    </>
  );
}
