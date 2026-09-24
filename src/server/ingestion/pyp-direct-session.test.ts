import { expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import {
  acquireDirectPypSession,
  parsePypDirectoryHtml,
} from "./pyp-direct-session";

const location = {
  LocationCode: "1265",
  LocationPageURL: "/inventory/test-1265/",
  Name: "PYP Test",
  DisplayName: "Test",
  Address: "1 Main St",
  City: "Test",
  State: "California",
  StateAbbr: "CA",
  Zip: "90000",
  Phone: "555-0100",
  Lat: 34,
  Lng: -118,
  Distance: 0,
  LegacyCode: "265",
  Primo: "",
  Urls: {
    Store: "",
    Interchange: "",
    Inventory: "",
    Prices: "",
    Directions: "",
    SellACar: "",
    Contact: "",
    CustomerServiceChat: null,
    CarbuyChat: null,
    Deals: "",
    Parts: "",
  },
};

test("reads the CSRF token and complete location array from PYP HTML", () => {
  const locations = Array.from({ length: 20 }, (_, index) => ({
    ...location,
    LocationCode: String(1265 + index),
    Name: index === 0 ? "Test ] yard" : location.Name,
  }));
  const html = `
    <script>var _locationList=${JSON.stringify(locations)};</script>
    <input name="__RequestVerificationToken" type="hidden" value="test-token" />
  `;
  const result = parsePypDirectoryHtml(html);
  expect(result.csrfToken).toBe("test-token");
  expect(result.locations).toHaveLength(20);
  expect(result.locations[0]?.locationCode).toBe("1265");
  expect(result.locations[0]?.name).toBe("Test ] yard");
});

test("rejects a Cloudflare challenge instead of treating it as inventory", () => {
  expect(() =>
    parsePypDirectoryHtml("<title>Just a moment...</title>"),
  ).toThrow("omitted CSRF token");
});

test("curl carries the inventory cookie and CSRF token, decodes JSON, and rejects HTTP errors", async () => {
  const locations = Array.from({ length: 20 }, (_, index) => ({
    ...location,
    LocationCode: String(1265 + index),
  }));
  const requests: Array<{
    page: string | null;
    cookie: string | null;
    token: string | null;
    referer: string | null;
  }> = [];
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === "/inventory/") {
        return new Response(
          `<script>var _locationList=${JSON.stringify(locations)};</script><input name="__RequestVerificationToken" value="test-csrf" />`,
          { headers: { "Set-Cookie": "test-session=ready; Path=/" } },
        );
      }
      if (url.pathname !== "/DesktopModules/pyp_api/api/Inventory/Filter") {
        return new Response("unexpected path", { status: 404 });
      }
      requests.push({
        page: url.searchParams.get("page"),
        cookie: request.headers.get("cookie"),
        token: request.headers.get("requestverificationtoken"),
        referer: request.headers.get("referer"),
      });
      if (url.searchParams.get("page") === "1") {
        return new Response("blocked", { status: 403 });
      }
      return Response.json({
        Success: true,
        Errors: [],
        ResponseData: {
          Request: {
            YardCode: ["1265"],
            Filter: "",
            PageSize: 500,
            PageNumber: 1,
            FilterDeals: false,
          },
          Vehicles: [
            {
              YardCode: "1265",
              Section: "Yard",
              Row: "1",
              SpaceNumber: "2",
              Color: "Blue",
              Year: "2020",
              Make: "HONDA",
              Model: "CIVIC",
              InYardDate: "2026-02-05T14:07:19Z",
              StockNumber: "1265-1",
              Vin: "2HGFC2F84LH554430",
              Photos: [],
            },
          ],
        },
        Messages: [],
      });
    },
  });
  const temporaryRoot = await mkdtemp(join(tmpdir(), "pyp-session-test-"));
  try {
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const session = yield* acquireDirectPypSession({
            baseUrl: server.url.origin,
            temporaryRoot,
          });
          const page = yield* session.fetchFilterPage("1265", 0, 500);
          const blocked = yield* session
            .fetchFilterPage("1265", 1, 500)
            .pipe(Effect.either);
          return { locations: session.locations, page, blocked };
        }),
      ),
    );

    expect(result.locations).toHaveLength(20);
    expect(result.page.ResponseData.Vehicles[0]?.Vin).toBe("2HGFC2F84LH554430");
    expect(result.blocked._tag).toBe("Left");
    if (result.blocked._tag !== "Left") {
      throw new Error("Expected HTTP 403 failure");
    }
    expect(result.blocked.left.message).toContain("status 403");
    expect(requests).toEqual([
      {
        page: "0",
        cookie: "test-session=ready",
        token: "test-csrf",
        referer: `${server.url.origin}/inventory/`,
      },
      {
        page: "1",
        cookie: "test-session=ready",
        token: "test-csrf",
        referer: `${server.url.origin}/inventory/`,
      },
    ]);
    expect(await readdir(temporaryRoot)).toEqual([]);
  } finally {
    server.stop(true);
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
