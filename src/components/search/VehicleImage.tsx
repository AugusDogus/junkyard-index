"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { Skeleton } from "~/components/ui/skeleton";
import wsrvLoader from "~/lib/wsrvLoader";

type VehicleImageProps = {
  src: string;
  alt: string;
  sizes: string;
  priority?: boolean;
};

export function VehicleImage({
  src,
  alt,
  sizes,
  priority = false,
}: VehicleImageProps) {
  const [useWsrvImage, setUseWsrvImage] = useState(true);
  const [isPrimaryImageLoading, setIsPrimaryImageLoading] = useState(true);
  const [isFallbackImageLoading, setIsFallbackImageLoading] = useState(false);
  const [isFallbackImageFailed, setIsFallbackImageFailed] = useState(false);

  useEffect(() => {
    setUseWsrvImage(true);
    setIsPrimaryImageLoading(true);
    setIsFallbackImageLoading(false);
    setIsFallbackImageFailed(false);
  }, [src]);

  if (useWsrvImage) {
    return (
      <>
        {isPrimaryImageLoading && !priority && (
          <Skeleton className="absolute inset-0" aria-hidden="true" />
        )}
        <Image
          priority={priority}
          loading={priority ? "eager" : "lazy"}
          fetchPriority={priority ? "high" : "auto"}
          loader={wsrvLoader}
          src={src}
          alt={alt}
          fill
          className={`object-cover transition-opacity duration-200 ${
            isPrimaryImageLoading && !priority ? "opacity-0" : "opacity-100"
          }`}
          sizes={sizes}
          onLoad={() => {
            setIsPrimaryImageLoading(false);
          }}
          onError={() => {
            setIsPrimaryImageLoading(false);
            setUseWsrvImage(false);
            setIsFallbackImageLoading(true);
          }}
        />
      </>
    );
  }

  return (
    <>
      {isFallbackImageLoading && !priority && (
        <Skeleton className="absolute inset-0" aria-hidden="true" />
      )}
      {isFallbackImageFailed ? (
        <div className="bg-muted flex h-full items-center justify-center">
          <div className="text-muted-foreground text-center">
            <p className="text-sm">No Image Available</p>
          </div>
        </div>
      ) : (
        <img
          src={src}
          alt={alt}
          className={`h-full w-full object-cover transition-opacity duration-200 ${
            isFallbackImageLoading && !priority ? "opacity-0" : "opacity-100"
          }`}
          loading={priority ? "eager" : "lazy"}
          fetchPriority={priority ? "high" : "auto"}
          decoding="async"
          referrerPolicy="no-referrer"
          onLoad={() => {
            setIsFallbackImageLoading(false);
          }}
          onError={() => {
            setIsFallbackImageLoading(false);
            setIsFallbackImageFailed(true);
          }}
        />
      )}
    </>
  );
}
