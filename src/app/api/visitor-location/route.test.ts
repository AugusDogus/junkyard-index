import { describe, expect, test } from "bun:test";
import { VisitorLocation } from "~/lib/visitor-location";
import { GET } from "./route";

describe("GET /api/visitor-location", () => {
  test("returns the visitor's approximate location from Vercel's IP headers", async () => {
    const response = GET(
      new Request("https://junkyardindex.com/api/visitor-location", {
        headers: {
          "x-vercel-ip-latitude": "39.2904",
          "x-vercel-ip-longitude": "-76.6122",
        },
      }),
    );

    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(VisitorLocation.parse(await response.json())).toEqual({
      lat: 39.2904,
      lng: -76.6122,
    });
  });

  test("returns no location when the headers are missing or out of range", async () => {
    const cases: Record<string, string>[] = [
      {},
      { "x-vercel-ip-latitude": "91", "x-vercel-ip-longitude": "0" },
      { "x-vercel-ip-latitude": "north", "x-vercel-ip-longitude": "0" },
    ];
    for (const headers of cases) {
      const response = GET(
        new Request("https://junkyardindex.com/api/visitor-location", {
          headers,
        }),
      );
      expect(await response.json()).toEqual({ location: null });
    }
  });
});

describe("VisitorLocation.parse", () => {
  test("accepts only a well-formed location", () => {
    expect(VisitorLocation.parse({ location: { lat: 1, lng: 2 } })).toEqual({
      lat: 1,
      lng: 2,
    });
    expect(VisitorLocation.parse({ location: null })).toBeNull();
    expect(VisitorLocation.parse({ location: { lat: "1" } })).toBeNull();
    expect(VisitorLocation.parse("nope")).toBeNull();
  });
});
