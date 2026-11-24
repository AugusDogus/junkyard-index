import { afterEach, expect, test } from "bun:test";
import { Effect, Either } from "effect";
import { z } from "zod";
import { validationRejectionKind } from "./ingestion-validation";
import { VINPLUS_API, VINPLUS_TENANTS } from "./vinplus-configuration";
import { VinplusCursor, VINPLUS_MAX_CURSOR_BYTES } from "./vinplus-cursor";
import { streamVinplusInventory } from "./vinplus-connector";
import { inspectVinplusEvidence } from "./vinplus-parser";
import { readVinplusControl } from "./vinplus-client";
import { vinplusCensus } from "./vinplus-test-fixtures";
import { runWithQueuedHost } from "./provider-host-test-support";
import { IngestionSourceFlags } from "./ingestion-source-flags";
import {
  isDurableSourceCursorTerminal,
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
  let warnings: string[] = [];
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
            expect(vehicles).toHaveLength(7_621);
            for (const vehicle of vehicles) {
              expect(VehicleDestination.resolve(vehicle).kind).toBe(
                vehicle.locationCode === "pocatello"
                  ? "unavailable"
                  : "manual-search",
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
    if (result.status === "complete") {
      warnings = result.warnings ?? [];
      expect(result.count).toBe(7_621);
      expect(result.observedVins).toHaveLength(48);
      expect(result.accounting).toEqual({
        recordsProcessed: 7_722,
        recordsRejected: 101,
        recordsExcluded: 0,
        duplicateVehicles: 0,
      });
    } else expect(result.warnings).toEqual([]);
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
  expect(warnings).toHaveLength(1);
  expect(
    isDurableSourceCursorTerminal(
      "vinplus",
      serializeDurableSourceCursor(cursor),
    ),
  ).toBe(true);
  expect(warnings.join(" ")).toContain(
    "195 Used Auto Parts: 6 unreachable advertised vehicles / 1581",
  );
  expect(callbacks).toBe(1);
  expect(yardCallbacks).toBe(1);
  expect(seenRequests).toBe(census.flat().length);
}, 600_000);

test("cursor rejects corruption, skipped controls, sibling tags, version and oversized wire", () => {
  const initial = VinplusCursor.initial();
  expect(DURABLE_SOURCE_DEFINITIONS.vinplus.maxPagesPerChunk).toBe(8);
  expect(IngestionSourceFlags.resolve({})).toContain("vinplus");
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

test("VinPlus keeps advancing when every API request waits minutes for a shared host turn", async () => {
  // Production VinPlus queue on 2026-11-19: about 20 sources shared one lease,
  // so each API control waited about 150 s for its turn.
  const census = vinplusCensus();
  const bodies = census.flat();
  const first = census[0];
  if (!first) throw new Error("Missing first tenant fixture");
  let requests = 0;
  globalThis.fetch = Object.assign(
    async (input: string | URL | Request) => {
      const body = bodies[requests++];
      if (body === undefined) throw new Error("Unexpected extra request");
      return new Response(body, {
        headers: {
          "Content-Type": String(input).startsWith(
            "https://vinplus.texnrewards.com/",
          )
            ? "text/html"
            : "application/json",
        },
      });
    },
    { preconnect: originalFetch.preconnect },
  );
  let cursor = VinplusCursor.initial();
  const pages: number[] = [];
  // Drive the first tenant through its opening and closing controls.
  while (cursor.yards.length === 1) {
    const chunk = await runWithQueuedHost(
      streamVinplusInventory({
        startCursor: cursor,
        maxPages: 8,
        readControl: (control) =>
          readVinplusControl(control, (effect) => effect),
        onBatch: () => Effect.void,
      }),
      { turnWaitMs: 150_000 },
    );
    if (Either.isLeft(chunk.result)) throw chunk.result.left;
    pages.push(chunk.result.right.pagesProcessed);
    cursor = parseDurableSourceCursor(
      "vinplus",
      serializeDurableSourceCursor(chunk.result.right.cursor),
    );
    // Every chunk advances, returns its checkpoint and releases each lease.
    expect(chunk.result.right.pagesProcessed).toBeGreaterThan(0);
    expect(chunk.elapsedMs).toBeLessThanOrEqual(6 * 60_000);
    expect(chunk.turns.every((turn) => turn.releasedAt !== null)).toBe(true);
  }
  expect(cursor.yards[0]).toEqual(first);
  expect(pages.reduce((sum, page) => sum + page, 0)).toBe(requests);
  // Two queued turns per chunk; the app pages around them are not queued.
  expect(pages).toEqual([3, 2, 2, 2, 2, 2, 2, 2, 2, 2, 4]);
}, 120_000);

test("a year distribution too stale to vouch for a yard rejects the crawl as transient", async () => {
  const [app, config, , opening] = vinplusCensus()[0] ?? [];
  if (!app || !config || !opening) throw new Error("Missing Pocatello fixture");
  const matches = z
    .object({ matches: z.array(z.record(z.unknown())) })
    .passthrough()
    .parse(JSON.parse(opening))
    .matches.slice(0, 10)
    .map((record) => ({ ...record, year: 2000 }));
  // The cached distribution still counts 20 vehicles; live search has 10.
  const analytics = JSON.stringify({
    success: true,
    data: { current_count: 20, by_year: [{ year: "2000", count: 20 }] },
  });
  const search = JSON.stringify({
    success: true,
    match_count: matches.length,
    matches,
    search_criteria: {
      yard_id: "u_pull_auto_parts_pocatello",
      year_min: 2000,
      year_max: 2000,
      make: null,
      model: null,
    },
  });
  const bodies = [app, config, analytics, search];
  let requests = 0;
  const result = await Effect.runPromise(
    Effect.either(
      streamVinplusInventory({
        maxPages: 16,
        readControl: () => {
          const body = bodies[requests++];
          return body === undefined
            ? Effect.die(new Error("Unexpected extra request"))
            : Effect.succeed(body);
        },
        onBatch: () => Effect.void,
      }),
    ),
  );
  if (Either.isRight(result)) throw new Error("Stale distribution passed");
  expect(result.left.message).toContain("This exceeds the 1% lag limit");
  expect(validationRejectionKind(result.left)).toBe("transient");
}, 30_000);
