import { afterEach, describe, expect, spyOn, test } from "bun:test";
import {
  isDurableSourceCursorTerminal,
  serializeDurableSourceCursor,
} from "./durable-source";
import { Effect } from "effect";
import { streamHagermanInventoryWithRequestGate } from "./hagerman-connector";
import { HagermanCursor, HagermanCursorSchema } from "./hagerman-cursor";
import {
  HAGERMAN_CATALOG_URL,
  HAGERMAN_PROFILE_URL,
  HagermanCatalog,
  HagermanDonor,
  HagermanPageSchema,
  HagermanProfile,
} from "./hagerman-parser";
import { hagermanPageHash } from "./hagerman-catalog";
import type { ProviderRequestGate } from "./provider-http-client";
import { hagermanFixture } from "./hagerman-test-fixtures";
import type { HagermanCanonicalVehicle } from "./hagerman-transform";
import {
  HAGERMAN_COORDINATES,
  type HagermanYard,
} from "./hagerman-yard-metadata";

const gate: ProviderRequestGate = (request) => request;
const noop = () => Effect.void;
let restore = () => {};
afterEach(() => restore());

function savedResponses(
  change: (url: string, body: string, ordinal: number) => string = (
    _url,
    body,
  ) => body,
) {
  const requests: string[] = [];
  const page = HagermanCatalog.parse(hagermanFixture("catalog"));
  const bodies = new Map([
    [HAGERMAN_CATALOG_URL, hagermanFixture("catalog")],
    [HAGERMAN_PROFILE_URL, hagermanFixture("contact")],
    ...page.members.map((member): [string, string] => [
      member.url,
      hagermanFixture(member.id),
    ]),
  ]);
  const mock = spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async (
        input: Parameters<typeof fetch>[0],
        options?: Parameters<typeof fetch>[1],
      ) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        const body = bodies.get(url);
        if (body === undefined)
          throw new Error("No saved Hagerman body for " + url);
        expect(options?.redirect).toBe("manual");
        requests.push(url);
        return new Response(change(url, body, requests.length), {
          headers: { "content-type": "text/html; charset=UTF-8" },
        });
      },
      { preconnect: globalThis.fetch.preconnect },
    ),
  );
  restore = () => mock.mockRestore();
  return requests;
}

describe("Hagerman resumable collector using actual saved responses only", () => {
  test("full terminal proof assesses every primary and closes membership and identity before callbacks", async () => {
    const requests = savedResponses();
    const vehicles: HagermanCanonicalVehicle[] = [],
      yards: HagermanYard[] = [];
    const result = await Effect.runPromise(
      streamHagermanInventoryWithRequestGate(
        {
          onBatch: (batch) =>
            Effect.sync(() => {
              expect(requests.length).toBe(9);
              vehicles.push(...batch);
            }),
          onYards: (batch) => Effect.sync(() => yards.push(...batch)),
        },
        gate,
      ),
    );
    expect(result.status).toBe("complete");
    expect(result.cursor.phase).toBe("complete");
    expect(result.pagesProcessed).toBe(9);
    expect(
      isDurableSourceCursorTerminal(
        "hagerman",
        serializeDurableSourceCursor(result.cursor),
      ),
    ).toBe(true);
    expect(result.accounting).toEqual({
      recordsProcessed: 5,
      recordsExcluded: 0,
      recordsRejected: 0,
      duplicateVehicles: 0,
    });
    expect(result.observedVins.length).toBe(5);
    expect(vehicles.length).toBe(5);
    expect(yards.map((yard) => yard.code)).toEqual(["umatilla"]);
    expect(requests.filter((url) => url === HAGERMAN_CATALOG_URL).length).toBe(
      2,
    );
    expect(requests.filter((url) => url === HAGERMAN_PROFILE_URL).length).toBe(
      2,
    );
    expect(
      vehicles.find((vehicle) => vehicle.stockNumber === "9AAL6262")?.model,
    ).toBe("AT9500");
  });

  test("one-request chunks resume JSON checkpoints without skipped or repeated primary details", async () => {
    const requests = savedResponses();
    let cursor: HagermanCursor = HagermanCursor.initial;
    let emitted = 0;
    for (let index = 0; index < 9; index++) {
      const result = await Effect.runPromise(
        streamHagermanInventoryWithRequestGate(
          {
            startCursor: cursor,
            maxPages: 1,
            onBatch: (batch) =>
              Effect.sync(() => {
                emitted += batch.length;
              }),
          },
          gate,
        ),
      );
      cursor = HagermanCursorSchema.parse(
        JSON.parse(JSON.stringify(result.cursor)),
      );
      expect(result.pagesProcessed).toBe(1);
      expect(result.status).toBe(index === 8 ? "complete" : "paused");
      if (index < 8) expect(emitted).toBe(0);
    }
    expect(emitted).toBe(5);
    expect(new Set(requests.filter((url) => url.includes("/item/"))).size).toBe(
      5,
    );
    const complete = await Effect.runPromise(
      streamHagermanInventoryWithRequestGate(
        { startCursor: cursor, onBatch: noop },
        gate,
      ),
    );
    expect(complete.status).toBe("complete");
    expect(complete.pagesProcessed).toBe(0);
    expect(requests.length).toBe(9);
  });

  test("failed vehicle callback preserves the supplied checkpoint and does not report completion", async () => {
    const requests = savedResponses();
    const paused = await Effect.runPromise(
      streamHagermanInventoryWithRequestGate(
        { maxPages: 8, onBatch: noop },
        gate,
      ),
    );
    const checkpoint = JSON.stringify(paused.cursor);
    const failed = await Effect.runPromise(
      Effect.either(
        streamHagermanInventoryWithRequestGate(
          {
            startCursor: paused.cursor,
            onBatch: () => Effect.fail("staging unavailable"),
          },
          gate,
        ),
      ),
    );
    expect(failed._tag).toBe("Left");
    if (failed._tag !== "Left") throw new Error("Expected callback failure");
    expect(failed.left).toBe("staging unavailable");
    expect(JSON.stringify(paused.cursor)).toBe(checkpoint);
    const resumed = await Effect.runPromise(
      streamHagermanInventoryWithRequestGate(
        { startCursor: paused.cursor, onBatch: noop },
        gate,
      ),
    );
    expect(resumed.status).toBe("complete");
    expect(requests.length).toBe(10);
    expect(new Set(requests.filter((url) => url.includes("/item/"))).size).toBe(
      5,
    );
  });

  test("yard callback failure also propagates without a successful terminal checkpoint", async () => {
    savedResponses();
    const result = await Effect.runPromise(
      Effect.either(
        streamHagermanInventoryWithRequestGate(
          { onBatch: noop, onYards: () => Effect.fail("yard stage failed") },
          gate,
        ),
      ),
    );
    expect(result._tag).toBe("Left");
    if (result._tag !== "Left")
      throw new Error("Expected yard callback failure");
    expect(result.left).toBe("yard stage failed");
  });

  test("a required-field failure in one of five donors fails quality before closing or publication", async () => {
    const requests = savedResponses((url, raw) =>
      url.includes("/8012/")
        ? raw.replace(/(class="[^"]*e72-e45[^"]*"[^>]*>)9200(<\/div>)/, "$1$2")
        : raw,
    );
    let callbacks = 0;
    const result = await Effect.runPromise(
      Effect.either(
        streamHagermanInventoryWithRequestGate(
          {
            onBatch: () =>
              Effect.sync(() => {
                callbacks++;
              }),
          },
          gate,
        ),
      ),
    );
    expect(result._tag).toBe("Left");
    expect(callbacks).toBe(0);
    expect(requests.length).toBe(7);
  });

  test("closing membership drift cannot publish an opening snapshot", async () => {
    const requests = savedResponses((url, raw, ordinal) =>
      url === HAGERMAN_CATALOG_URL && ordinal > 2
        ? raw.replaceAll("#CHA11021", "#CHANGED")
        : raw,
    );
    let callbacks = 0;
    const result = await Effect.runPromise(
      Effect.either(
        streamHagermanInventoryWithRequestGate(
          {
            onBatch: () =>
              Effect.sync(() => {
                callbacks++;
              }),
          },
          gate,
        ),
      ),
    );
    expect(result._tag).toBe("Left");
    expect(callbacks).toBe(0);
    expect(requests.length).toBe(8);
  });

  test("checkpoint rejects missing, repeated, swapped or forged closing assessments before HTTP", async () => {
    const requests = savedResponses();
    const paused = await Effect.runPromise(
      streamHagermanInventoryWithRequestGate(
        { maxPages: 4, onBatch: noop },
        gate,
      ),
    );
    if (paused.cursor.phase !== "details")
      throw new Error("Expected actual primary assessment checkpoint");
    const cursor = paused.cursor;
    const first = cursor.donors[0],
      second = cursor.donors[1];
    if (!first || !second) throw new Error("Expected two actual saved donors");
    expect(
      HagermanCursorSchema.safeParse({ ...cursor, donors: [second] }).success,
    ).toBe(false);
    expect(
      HagermanCursorSchema.safeParse({ ...cursor, donors: [first, first] })
        .success,
    ).toBe(false);
    expect(
      HagermanCursorSchema.safeParse({
        ...cursor,
        phase: "closing",
        donors: [],
      }).success,
    ).toBe(false);
    expect(
      HagermanCursorSchema.safeParse({
        ...cursor,
        phase: "complete",
        closing: "0".repeat(64),
        closingProfile: cursor.profile,
      }).success,
    ).toBe(false);
    const count = requests.length;
    const expired = await Effect.runPromise(
      Effect.either(
        streamHagermanInventoryWithRequestGate(
          {
            startCursor: { ...cursor, startedAt: Date.now() - 3_600_001 },
            onBatch: noop,
          },
          gate,
        ),
      ),
    );
    expect(expired._tag).toBe("Left");
    expect(requests.length).toBe(count);
  });

  test("a rejected valid VIN remains presence when a synthetic ten-row replay meets unchanged quality policy", async () => {
    const requests = savedResponses();
    const page = HagermanCatalog.parse(hagermanFixture("catalog"));
    const donors = page.members.map((member) =>
      HagermanDonor.parse(hagermanFixture(member.id), member),
    );
    // Explicit mock expansion, not evidence about the five actual native donors.
    const extraMembers = page.members.map((member) => ({
      ...member,
      id: member.id + "9",
      url: member.url.replace(/\d+\/$/, member.id + "9/"),
    }));
    const extraDonors = donors.map((donor) => ({
      ...donor,
      id: donor.id + "9",
      url: donor.url.replace(/\d+\/$/, donor.id + "9/"),
      imageUrl: null,
      vin: donor.vin.slice(0, -1) + String((Number(donor.vin.at(-1)) + 1) % 10),
    }));
    const opening = HagermanPageSchema.parse({
      total: 10,
      members: [...page.members, ...extraMembers],
    });
    const assessed = [...donors, ...extraDonors].map((donor, index) =>
      index === 9 ? { ...donor, model: "" } : donor,
    );
    const profile = HagermanProfile.parse(hagermanFixture("contact"));
    const cursor = HagermanCursorSchema.parse({
      source: "hagerman",
      version: 1,
      phase: "ready",
      startedAt: Date.now(),
      bytes: 1_000_000,
      coordinates: HAGERMAN_COORDINATES,
      previousAcceptedCount: null,
      profile,
      opening,
      donors: assessed,
      closing: hagermanPageHash(opening),
      closingProfile: profile,
    });
    const result = await Effect.runPromise(
      streamHagermanInventoryWithRequestGate(
        { startCursor: cursor, onBatch: noop },
        gate,
      ),
    );
    expect(result.status).toBe("complete");
    expect(result.count).toBe(9);
    expect(result.accounting.recordsRejected).toBe(1);
    expect(result.observedVins.length).toBe(10);
    const rejected = extraDonors[4];
    if (!rejected) throw new Error("Missing rejected mock donor");
    expect(result.observedVins).toContain(rejected.vin);
    expect(requests).toEqual([]);
  });
});
