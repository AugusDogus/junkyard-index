import { expect, test } from "bun:test";
import wsrvLoader from "./wsrvLoader";

test("Allied's CloudFront photos bypass the proxy that their origin blocks", () => {
  const src = "https://da8h1v3w8q6n5.cloudfront.net/kk25/photo.jpg?size=large";
  expect(wsrvLoader({ src, width: 256 })).toBe(src);
});

test("other hosts keep resizing and quality through wsrv", () => {
  const src = "https://photos.example.com/car.jpg?image=1&size=2";
  const result = new URL(wsrvLoader({ src, width: 256, quality: 85 }));
  expect(result.origin).toBe("https://wsrv.nl");
  expect(Object.fromEntries(result.searchParams)).toEqual({
    url: src,
    w: "256",
    q: "85",
    output: "webp",
  });
});

test("bypass matches the exact host and malformed input does not throw", () => {
  for (const src of [
    "https://da8h1v3w8q6n5.cloudfront.net.example.com/car.jpg",
    "not a URL",
  ]) {
    const result = new URL(wsrvLoader({ src, width: 128 }));
    expect(result.hostname).toBe("wsrv.nl");
    expect(result.searchParams.get("q")).toBe("75");
  }
});
