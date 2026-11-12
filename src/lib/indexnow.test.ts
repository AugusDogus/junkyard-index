import { describe, expect, test } from "bun:test";
import { INDEXNOW_KEY, IndexNow, type Send } from "./indexnow";

const origin = "https://junkyardindex.com";

describe("IndexNow.payloads", () => {
  test("builds absolute, deduplicated URLs with the key location", () => {
    expect(
      IndexNow.payloads(origin, ["/junkyards", "/junkyards", "/cars/honda"]),
    ).toEqual([
      {
        host: "junkyardindex.com",
        key: INDEXNOW_KEY,
        keyLocation: `https://junkyardindex.com/${INDEXNOW_KEY}.txt`,
        urlList: [
          "https://junkyardindex.com/junkyards",
          "https://junkyardindex.com/cars/honda",
        ],
      },
    ]);
  });

  test("splits more than 10,000 URLs into several requests", () => {
    const paths = Array.from({ length: 10_001 }, (_, index) => `/p/${index}`);
    expect(
      IndexNow.payloads(origin, paths).map((body) => body.urlList.length),
    ).toEqual([10_000, 1]);
  });
});

describe("IndexNow.submit", () => {
  const respond =
    (status: number): Send =>
    async () =>
      new Response("rejected", { status });

  test("skips when nothing changed", async () => {
    expect(await IndexNow.submit(origin, [], respond(200))).toEqual({
      status: "skipped",
      reason: "no changed URLs",
    });
  });

  test("counts accepted and pending submissions", async () => {
    expect(await IndexNow.submit(origin, ["/a", "/b"], respond(202))).toEqual({
      status: "submitted",
      urls: 2,
    });
  });

  test("reports a rejected submission", async () => {
    expect(await IndexNow.submit(origin, ["/a"], respond(422))).toEqual({
      status: "failed",
      urls: 1,
      httpStatus: 422,
      detail: "rejected",
    });
  });
});
