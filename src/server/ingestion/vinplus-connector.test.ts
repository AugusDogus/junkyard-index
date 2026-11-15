import { afterEach, expect, test } from "bun:test";
import { Effect } from "effect";
import { VINPLUS_API, VINPLUS_TENANTS } from "./vinplus-configuration";
import { VinplusCursor, VINPLUS_MAX_CURSOR_BYTES } from "./vinplus-cursor";
import { streamVinplusInventory } from "./vinplus-connector";
import { inspectVinplusEvidence } from "./vinplus-parser";
import { readVinplusControl } from "./vinplus-client";
import { vinplusCensus } from "./vinplus-test-fixtures";
import { IngestionSourceFlags } from "./ingestion-source-flags";
import {
  parseDurableSourceCursor,
  serializeDurableSourceCursor,
  DURABLE_SOURCE_DEFINITIONS,
} from "./durable-source";
import { VehicleDestination } from "~/lib/vehicle-destination";
import { resolveYardWebsite } from "~/lib/yard-website";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
test("complete frozen census replays through transport, chunking and durable checkpoints", async () => {
  const census = vinplusCensus();
  let yardIndex = 0,
    responseIndex = 0,
    callbacks = 0,
    yardCallbacks = 0,
    seenRequests = 0;
  globalThis.fetch = Object.assign(
    async (input: string | URL | Request, init?: RequestInit) => {
      const tenant = VINPLUS_TENANTS[yardIndex];
      const bodies = census[yardIndex];
      if (!tenant || !bodies)
        throw new Error("Unexpected extra network request");
      const url = String(input);
      expect([
        `https://vinplus.texnrewards.com/parts/${tenant.slug}`,
        VINPLUS_API + "/api/yard-info/" + tenant.yardId,
        VINPLUS_API +
          "/api/analytics/year-distribution?yard_id=" +
          tenant.yardId,
        VINPLUS_API + "/api/vehicle-groups",
        VINPLUS_API + "/searchVehicleHttp",
      ]).toContain(url);
      expect(init?.redirect).toBe("manual");
      const body = bodies[responseIndex];
      if (body === undefined) throw new Error("Missing frozen response");
      responseIndex++;
      seenRequests++;
      if (responseIndex === bodies.length) {
        yardIndex++;
        responseIndex = 0;
      }
      return new Response(body, {
        headers: {
          "Content-Type": url.startsWith("https://vinplus.texnrewards.com/")
            ? "text/html"
            : "application/json",
        },
      });
    },
    { preconnect: originalFetch.preconnect },
  );
  let cursor = VinplusCursor.initial();
  while (cursor.phase !== "complete") {
    const result = await Effect.runPromise(
      streamVinplusInventory({
        startCursor: cursor,
        maxPages: 16,
        readControl: (control) =>
          readVinplusControl(control, (effect) => effect),
        onBatch: (vehicles) =>
          Effect.sync(() => {
            callbacks++;
            expect(vehicles).toHaveLength(4_776);
            for (const vehicle of vehicles) {
              expect(VehicleDestination.resolve(vehicle).kind).toBe(
                "manual-search",
              );
              expect(vehicle.lat).not.toBe(0);
              expect(vehicle.lng).not.toBe(0);
            }
          }),
        onYards: (yards) =>
          Effect.sync(() => {
            yardCallbacks++;
            expect(yards).toHaveLength(VINPLUS_TENANTS.length);
          }),
      }),
    );
    cursor = parseDurableSourceCursor(
      "vinplus",
      serializeDurableSourceCursor(result.cursor),
    );
    if (result.status === "paused") {
      expect(result.count).toBe(0);
      expect(result.observedVins).toEqual([]);
      expect(
        Object.values(result.accounting ?? {}).every((value) => value === 0),
      ).toBe(true);
      expect(callbacks).toBe(0);
      expect(yardCallbacks).toBe(0);
    }
  }
  expect(callbacks).toBe(1);
  expect(yardCallbacks).toBe(1);
  expect(seenRequests).toBe(census.flat().length);
}, 600_000);

test("cursor rejects corruption, skipped controls, sibling tags, version and oversized wire", () => {
  const initial = VinplusCursor.initial();
  expect(DURABLE_SOURCE_DEFINITIONS.vinplus.maxPagesPerChunk).toBe(8);
  expect(IngestionSourceFlags.resolve({})).not.toContain("vinplus");
  expect(() =>
    VinplusCursor.parse({ ...initial, phase: "complete" }),
  ).toThrow();
  expect(() =>
    VinplusCursor.parse({ ...initial, source: "pickers" }),
  ).toThrow();
  expect(() => VinplusCursor.parse({ ...initial, version: 2 })).toThrow();
  expect(() =>
    VinplusCursor.parse({ ...initial, yards: [["untrusted"]] }),
  ).toThrow();
  expect(() =>
    VinplusCursor.fromWire(" ".repeat(VINPLUS_MAX_CURSOR_BYTES + 1)),
  ).toThrow("before JSON parsing");
  expect(() =>
    VinplusCursor.checkpoint({ ...initial, yards: [["not an app"]] }),
  ).toThrow();
  expect(() =>
    VinplusCursor.checkpoint({ ...initial, yards: [[], []] }),
  ).toThrow("earlier yard");
});
test("each business has its own yard website and physical destination", () => {
  for (const tenant of VINPLUS_TENANTS) {
    if (!tenant.yard.websiteUrl) throw new Error("Missing yard website");
    expect(resolveYardWebsite(tenant.yard)).toEqual({
      kind: "yard",
      href: tenant.yard.websiteUrl,
    });
    expect(resolveYardWebsite({ ...tenant.yard, websiteUrl: null })).toEqual({
      kind: "yard",
      href: tenant.yard.websiteUrl,
    });
  }
});
test("HTTP partial, redirects, wrong MIME, wrong endpoint and oversized bodies fail closed", async () => {
  const tenant = VINPLUS_TENANTS[0];
  if (!tenant) throw new Error("Missing tenant");
  const progress = inspectVinplusEvidence(tenant, []);
  if (progress.kind !== "pending") throw new Error("Expected app control");
  for (const [status, headers] of [
    [206, { "Content-Type": "text/html" }],
    [302, { "Content-Type": "text/html" }],
    [200, { "Content-Type": "application/json" }],
    [200, { "Content-Type": "text/html", "content-range": "bytes 0-9/100" }],
  ] as const) {
    globalThis.fetch = Object.assign(
      async () => new Response("partial", { status, headers }),
      { preconnect: originalFetch.preconnect },
    );
    const result = await Effect.runPromise(
      Effect.either(readVinplusControl(progress.control, (effect) => effect)),
    );
    expect(result._tag).toBe("Left");
  }
  expect(
    (
      await Effect.runPromise(
        Effect.either(
          readVinplusControl(
            { ...progress.control, url: "https://example.com/" },
            (effect) => effect,
          ),
        ),
      )
    )._tag,
  ).toBe("Left");
  for (const response of [
    new Response("x".repeat(4 * 1024 * 1024 + 1), {
      headers: { "Content-Type": "text/html" },
    }),
    Object.defineProperty(
      new Response("wrong URL", { headers: { "Content-Type": "text/html" } }),
      "url",
      { value: "https://example.com/" },
    ),
  ]) {
    globalThis.fetch = Object.assign(async () => response, {
      preconnect: originalFetch.preconnect,
    });
    expect(
      (
        await Effect.runPromise(
          Effect.either(
            readVinplusControl(progress.control, (effect) => effect),
          ),
        )
      )._tag,
    ).toBe("Left");
  }
});

test("callback failure returns no advanced terminal checkpoint", async () => {
  const census = vinplusCensus();
  const last = census.at(-1);
  const body = last?.at(-1);
  if (!last || body === undefined) throw new Error("Missing terminal fixture");
  const start = VinplusCursor.checkpoint({
    ...VinplusCursor.initial(),
    yards: [...census.slice(0, -1), last.slice(0, -1)],
  });
  const wire = VinplusCursor.serialize(start);
  const result = await Effect.runPromise(
    Effect.either(
      streamVinplusInventory({
        startCursor: start,
        maxPages: 1,
        readControl: () => Effect.succeed(body),
        onBatch: () => Effect.fail("staging failed"),
      }),
    ),
  );
  expect(result._tag).toBe("Left");
  if (result._tag !== "Left")
    throw new Error("Staging failure returned a checkpoint");
  expect(result.left).toBe("staging failed");
  expect(VinplusCursor.serialize(start)).toBe(wire);
}, 30_000);

test("production gate serializes complete bodies and waits 1.6 seconds before the next request", async () => {
  const tenant = VINPLUS_TENANTS[0];
  if (!tenant) throw new Error("Missing tenant");
  const progress = inspectVinplusEvidence(tenant, []);
  if (progress.kind !== "pending") throw new Error("Expected app control");
  const starts: number[] = [],
    ends: number[] = [];
  globalThis.fetch = Object.assign(
    async () => {
      starts.push(Date.now());
      return new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            controller.enqueue(new TextEncoder().encode("<html></html>"));
            controller.close();
            ends.push(Date.now());
          },
        }),
        { headers: { "Content-Type": "text/html" } },
      );
    },
    { preconnect: originalFetch.preconnect },
  );
  await Effect.runPromise(
    Effect.all(
      [
        readVinplusControl(progress.control),
        readVinplusControl(progress.control),
      ],
      { concurrency: 2 },
    ),
  );
  const second = starts[1],
    firstEnd = ends[0];
  if (second === undefined || firstEnd === undefined)
    throw new Error("Missing request timing");
  expect(second - firstEnd).toBeGreaterThanOrEqual(1550);
}, 10_000);
