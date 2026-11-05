import { expect, test } from "bun:test";
import { PageWarmup, type Fetch } from "./page-warmup";

test("requests each page once by its absolute URL", async () => {
  const requested: string[] = [];
  const send: Fetch = async (url) => {
    requested.push(url);
    return new Response("ok");
  };
  expect(
    await PageWarmup.run(
      "https://junkyardindex.com",
      ["/junkyards", "/cars/honda", "/junkyards"],
      send,
    ),
  ).toEqual({ warmed: 2, failed: 0 });
  expect(requested.sort()).toEqual([
    "https://junkyardindex.com/cars/honda",
    "https://junkyardindex.com/junkyards",
  ]);
});

test("counts error responses and failed requests without stopping", async () => {
  const send: Fetch = async (url) => {
    if (url.endsWith("/gone")) return new Response("", { status: 404 });
    if (url.endsWith("/down")) throw new Error("connection reset");
    return new Response("ok");
  };
  expect(
    await PageWarmup.run(
      "https://junkyardindex.com",
      ["/gone", "/down", "/a", "/b"],
      send,
    ),
  ).toEqual({ warmed: 2, failed: 2 });
});

test("keeps at most four requests in flight", async () => {
  let inFlight = 0;
  let most = 0;
  const send: Fetch = async () => {
    inFlight++;
    most = Math.max(most, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 1));
    inFlight--;
    return new Response("ok");
  };
  const paths = Array.from({ length: 20 }, (_, index) => `/page-${index}`);
  expect(
    await PageWarmup.run("https://junkyardindex.com", paths, send),
  ).toEqual({ warmed: 20, failed: 0 });
  expect(most).toBe(4);
});
