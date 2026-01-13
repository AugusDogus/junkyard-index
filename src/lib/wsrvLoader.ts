type LoaderProps = { src: string; width: number; quality?: number };

export default function wsrvLoader({ src, width, quality }: LoaderProps) {
  const params = new URLSearchParams({
    url: src,
    w: String(width),
    q: String(quality ?? 75),
    output: "webp",
  });
  return `https://wsrv.nl/?${params.toString()}`;
}
