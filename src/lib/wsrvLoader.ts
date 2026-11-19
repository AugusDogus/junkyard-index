type LoaderProps = { src: string; width: number; quality?: number };

export default function wsrvLoader({ src, width, quality }: LoaderProps) {
  // Allied's CDN serves browsers but rejects wsrv's origin fetch with 403.
  // Keep this host-specific so other providers retain resized thumbnails.
  if (
    URL.canParse(src) &&
    new URL(src).hostname === "da8h1v3w8q6n5.cloudfront.net"
  ) {
    return src;
  }
  const params = new URLSearchParams({
    url: src,
    w: String(width),
    q: String(quality ?? 75),
    output: "webp",
  });
  return `https://wsrv.nl/?${params.toString()}`;
}
