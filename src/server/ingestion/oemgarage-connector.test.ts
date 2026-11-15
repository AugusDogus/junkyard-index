import { describe, expect, test, spyOn } from "bun:test";
import { Effect } from "effect";
import { streamOemgarageInventory } from "./oemgarage-connector";
import { OemgarageCursor } from "./oemgarage-cursor";
import { OemgarageProviderError, readOemgaragePage } from "./oemgarage-client";
import { oemgarageHash } from "./oemgarage-parser";
import {
  oemgarageSnapshot,
  validateOemgarageSnapshot,
  type OemgarageVehicle,
} from "./oemgarage-transform";
import {
  oemgarageFixture,
  oemgarageOpeningFixture,
} from "./oemgarage-test-fixtures";
import { OEMGARAGE_YARD } from "./oemgarage-yard-metadata";

function closingState() {
  const fixture = oemgarageOpeningFixture();
  const initial = OemgarageCursor.initial();
  return {
    source: initial.source,
    version: initial.version,
    scope: initial.scope,
    ownerHash: oemgarageHash(OEMGARAGE_YARD),
    catalog: fixture.catalog,
    opening: fixture.records,
  };
}
const unexpected = (url: string) =>
  Effect.fail(
    new OemgarageProviderError("test route", "Unexpected request: " + url),
  );
describe("oeM Garage complete donor guards", () => {
  test("all 258 saved opening donors reconcile without hiding 19 required-field rejects", () => {
    const { catalog, records } = oemgarageOpeningFixture(),
      snapshot = oemgarageSnapshot(catalog, records);
    expect(snapshot.vehicles).toHaveLength(239);
    expect(snapshot.accounting).toEqual({
      recordsProcessed: 258,
      recordsRejected: 19,
      recordsExcluded: 0,
      duplicateVehicles: 0,
    });
    expect(snapshot.observedVins).toHaveLength(258);
    expect(snapshot.conflictingVins).toEqual([]);
    expect(() => validateOemgarageSnapshot(snapshot)).not.toThrow();
    expect(() => validateOemgarageSnapshot(snapshot, 500)).toThrow(
      "previous-count",
    );
    expect(() => oemgarageSnapshot(catalog, records.slice(1))).toThrow(
      "complete ordered",
    );
  });
  test("bounded resume emits nothing until the entire closing frontier and owner finish", async () => {
    const calls: string[] = [],
      emitted: OemgarageVehicle[][] = [];
    const readPage = (url: string) => {
      calls.push(url);
      const name = url.endsWith("/collections/vehicles-dismantled")
        ? "oemgarage-donors"
        : url.endsWith("/collections/donor-636")
          ? "oemgarage-donor-636"
          : url === "https://oe-mgarage.com/"
            ? "dov-oemgarage"
            : null;
      return name
        ? Effect.succeed(oemgarageFixture(name).body)
        : unexpected(url);
    };
    const onBatch = (batch: OemgarageVehicle[]) =>
      Effect.sync(() => {
        emitted.push(batch);
      });
    const first = await Effect.runPromise(
      streamOemgarageInventory({
        previousUniqueInventory: null,
        maxPages: 2,
        readPage,
        onBatch,
      }),
    );
    expect(first.status).toBe("paused");
    expect(first.cursor.phase).toBe("opening");
    expect(calls).toHaveLength(2);
    expect(emitted).toEqual([]);
    const second = await Effect.runPromise(
      streamOemgarageInventory({
        previousUniqueInventory: null,
        maxPages: 1,
        startCursor: JSON.parse(JSON.stringify(first.cursor)),
        readPage,
        onBatch,
      }),
    );
    expect(second.cursor.phase).toBe("opening");
    if (second.cursor.phase !== "opening")
      throw new Error("Wrong resumed phase");
    expect(second.cursor.opening[0]?.card.id).toBe("636");
    expect(emitted).toEqual([]);
    await expect(
      Effect.runPromise(
        streamOemgarageInventory({
          previousUniqueInventory: null,
          maxPages: 1,
          startCursor: { ...second.cursor, checksum: "0".repeat(64) },
          readPage,
          onBatch,
        }),
      ),
    ).rejects.toThrow("checksum");
    expect(calls).toHaveLength(3);
  });
  test("closing required VIN drift aborts before callbacks or the next request", async () => {
    const state = closingState(),
      first = state.opening[0];
    if (!first) throw new Error("Missing native opening record");
    const html = oemgarageFixture("oemgarage-donor-636").body.replace(
      first.fields.VIN ?? "missing",
      "WBA7E2C59GG504712",
    );
    let calls = 0,
      emitted = 0;
    await expect(
      Effect.runPromise(
        streamOemgarageInventory({
          previousUniqueInventory: null,
          maxPages: 8,
          startCursor: OemgarageCursor.checkpoint({
            ...state,
            phase: "closing",
            closing: [],
          }),
          readPage: () => {
            calls++;
            return Effect.succeed(html);
          },
          onBatch: () =>
            Effect.sync(() => {
              emitted++;
            }),
        }),
      ),
    ).rejects.toThrow("closing required");
    expect(calls).toBe(1);
    expect(emitted).toBe(0);
  });
  test("owner closure emits reconciled donors and nulls changed optional metadata", async () => {
    const state = closingState();
    const closing = state.opening.map((r) =>
      r.card.id === "100"
        ? { ...r, fields: { ...r.fields, "Exterior color": "Silver" } }
        : r,
    );
    const emitted: OemgarageVehicle[][] = [];
    const result = await Effect.runPromise(
      streamOemgarageInventory({
        previousUniqueInventory: null,
        startCursor: OemgarageCursor.checkpoint({
          ...state,
          phase: "owner-closing",
          closing,
        }),
        readPage: () => Effect.succeed(oemgarageFixture("dov-oemgarage").body),
        onBatch: (batch) =>
          Effect.sync(() => {
            emitted.push(batch);
          }),
      }),
    );
    expect(result.status).toBe("complete");
    expect(result.count).toBe(239);
    expect(emitted).toHaveLength(1);
    expect(emitted[0]?.find((v) => v.stockNumber === "100")?.color).toBeNull();
    expect(result.accounting.recordsRejected).toBe(19);
  });
  test("closing Series drift cannot change the required model behind a stable heading", () => {
    const state = closingState();
    expect(() =>
      OemgarageCursor.checkpoint({
        ...state,
        phase: "owner-closing",
        closing: state.opening.map((r) =>
          r.card.id === "100"
            ? { ...r, fields: { ...r.fields, Series: "G11" } }
            : r,
        ),
      }),
    ).toThrow("closing required");
  });
  test("changed catalog or physical owner aborts without emitting inventory", async () => {
    const state = closingState();
    for (const phase of ["closing-catalog", "owner-closing"] as const) {
      let calls = 0,
        emitted = 0;
      const cursor =
        phase === "closing-catalog"
          ? OemgarageCursor.checkpoint({ ...state, phase })
          : OemgarageCursor.checkpoint({
              ...state,
              phase,
              closing: state.opening,
            });
      const html =
        phase === "closing-catalog"
          ? oemgarageFixture("oemgarage-donors").body.replaceAll(
              "donor-636",
              "donor-999999",
            )
          : oemgarageFixture("dov-oemgarage").body.replaceAll(
              "5808 Dawson Street",
              "9999 Other Street",
            );
      await expect(
        Effect.runPromise(
          streamOemgarageInventory({
            previousUniqueInventory: null,
            startCursor: cursor,
            readPage: () => {
              calls++;
              return Effect.succeed(html);
            },
            onBatch: () =>
              Effect.sync(() => {
                emitted++;
              }),
          }),
        ),
      ).rejects.toThrow(
        phase === "closing-catalog" ? "membership" : "physical owner",
      );
      expect(calls).toBe(1);
      expect(emitted).toBe(0);
    }
  });
  test("native required identity conflicts quarantine both donor rows", () => {
    const { catalog, records } = oemgarageOpeningFixture(),
      first = records[0],
      second = records[1];
    if (!first || !second)
      throw new Error("Missing actual native opening records");
    const changed = records.map((r, i) =>
      i === 1
        ? { ...r, fields: { ...r.fields, VIN: first.fields.VIN ?? "" } }
        : r,
    );
    const snapshot = oemgarageSnapshot(catalog, changed);
    expect(snapshot.conflictingVins).toContain(first.fields.VIN ?? "");
    expect(snapshot.accounting.recordsRejected).toBe(21);
    expect(snapshot.vehicles.some((v) => v.vin === first.fields.VIN)).toBe(
      false,
    );
  });
  test("HTTP guards reject foreign destinations, non-HTML and 403 without retries", async () => {
    let calls = 0;
    const preconnect = globalThis.fetch.preconnect;
    const mocked = spyOn(globalThis, "fetch").mockImplementation(
      Object.assign(
        async () => {
          calls++;
          return new Response("denied", {
            status: 403,
            headers: { "content-type": "text/html" },
          });
        },
        { preconnect },
      ),
    );
    try {
      await expect(
        Effect.runPromise(
          readOemgaragePage(
            "https://foreign.example/collections/donor-100",
            (effect) => effect,
          ),
        ),
      ).rejects.toThrow("destination");
      expect(calls).toBe(0);
      await expect(
        Effect.runPromise(
          readOemgaragePage(
            "https://oe-mgarage.com/collections/donor-100",
            (effect) => effect,
          ),
        ),
      ).rejects.toThrow("HTTP403");
      expect(calls).toBe(1);
      mocked.mockImplementation(
        Object.assign(
          async () =>
            new Response("{}", {
              headers: { "content-type": "application/json" },
            }),
          { preconnect },
        ),
      );
      await expect(
        Effect.runPromise(
          readOemgaragePage(
            "https://oe-mgarage.com/collections/donor-100",
            (effect) => effect,
          ),
        ),
      ).rejects.toThrow("text/html");
    } finally {
      mocked.mockRestore();
    }
  });
});
