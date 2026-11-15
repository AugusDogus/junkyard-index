import { describe, expect, spyOn, test } from "bun:test";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { Effect } from "effect";
import { z } from "zod";
import { fetchDutchersPage, DutchersProviderError } from "./dutchers-client";
import { streamDutchersInventoryWithRequestGate } from "./dutchers-connector";
import { DutchersCursor, DutchersCursorSchema } from "./dutchers-cursor";
import { dutchersHash } from "./dutchers-html";
import { DutchersRecordSchema, parseDutchersCatalog } from "./dutchers-parser";
import { parseDutchersScope, parseDutchersStore } from "./dutchers-scope";
import {
  dutchersRoster,
  dutchersSnapshot,
  type DutchersCanonicalVehicle,
} from "./dutchers-snapshot";
import {
  DUTCHERS_SCOPE,
  DUTCHERS_STORE,
  dutchersCatalogUrl,
} from "./dutchers-yard-metadata";

// 100 actual dated documents: scope/store, both complete year orders, both
// closing orders, store/scope closure. Only comments, scripts and styles were
// removed. Original bytes and receipts remain in root-dutchers-htp research.
const fixture = z
  .array(z.string())
  .length(100)
  .parse(
    JSON.parse(
      gunzipSync(
        readFileSync(
          new URL("./dutchers-test-fixtures/native.json.gz", import.meta.url),
        ),
      ).toString(),
    ),
  );
function raw(index: number): string {
  const body = fixture[index];
  if (body === undefined)
    throw new Error("Missing Dutcher native fixture " + index);
  return body;
}
const scope = () => parseDutchersScope(raw(0));
const total = () => parseDutchersStore(raw(1));
const pages = (closing = false) =>
  (["DESC", "ASC"] as const).flatMap((direction, d) =>
    Array.from({ length: 24 }, (_, i) =>
      parseDutchersCatalog(
        raw((closing ? 50 : 2) + d * 24 + i),
        direction,
        i + 1,
        total(),
      ),
    ),
  );
const roster = () => dutchersRoster(pages(), total());
function first() {
  const record = pages()[0]?.records[0];
  if (record === undefined) throw new Error("Missing first native donor");
  return record;
}
function reader(change?: (body: string, index: number) => string) {
  const controls = (["DESC", "ASC"] as const).flatMap((d) =>
    Array.from({ length: 24 }, (_, i) => dutchersCatalogUrl(d, i + 1)),
  );
  const urls = [
    DUTCHERS_SCOPE,
    DUTCHERS_STORE,
    ...controls,
    ...controls,
    DUTCHERS_STORE,
    DUTCHERS_SCOPE,
  ];
  const calls: string[] = [];
  return {
    calls,
    readPage: (url: string) => {
      const index = calls.length;
      calls.push(url);
      return urls[index] !== url
        ? Effect.fail(
            new DutchersProviderError({
              operation: "saved replay",
              cause: "Unexpected native control " + url,
            }),
          )
        : Effect.succeed(change?.(raw(index), index) ?? raw(index));
    },
  };
}
const gate = <A, E, R>(request: Effect.Effect<A, E, R>) => request;
async function replay(
  input: ReturnType<typeof reader>,
  onBatch: (vehicles: DutchersCanonicalVehicle[]) => Effect.Effect<void>,
  maxPages = 16,
) {
  let cursor = DutchersCursor.initial();
  for (let i = 0; i < 100; i++) {
    const result = await Effect.runPromise(
      streamDutchersInventoryWithRequestGate(
        { startCursor: cursor, maxPages, readPage: input.readPage, onBatch },
        gate,
      ),
    );
    if (result.status === "complete") return result;
    cursor = DutchersCursor.parse(JSON.parse(JSON.stringify(result.cursor)));
  }
  throw new Error("Dutcher replay failed to terminate");
}

describe("Dutcher heavy division complete native census", () => {
  test("replays all 100 controls before emitting 579 unique NY donor vehicles", async () => {
    const input = reader(),
      batches: DutchersCanonicalVehicle[][] = [];
    const result = await replay(input, (vehicles) =>
      Effect.sync(() => {
        expect(input.calls).toHaveLength(100);
        batches.push(vehicles);
      }),
    );
    expect(result.status).toBe("complete");
    expect(result.count).toBe(579);
    expect(result.accounting).toEqual({
      recordsProcessed: 587,
      recordsExcluded: 0,
      recordsRejected: 7,
      duplicateVehicles: 1,
    });
    expect(new Set(result.observedVins)).toEqual(
      new Set([
        "3ALACXD22LDLY9806",
        "1FVACXFC4LHKZ0503",
        "3ALACWD21LDME1173",
        "3ALDCXFE1LDKV4207",
      ]),
    );
    expect(batches).toHaveLength(1);
    expect(batches[0]?.[0]).toMatchObject({
      source: "dutchers",
      stateAbbr: "NY",
      stockNumber: null,
      color: null,
      availableDate: null,
      section: null,
      row: null,
      space: null,
    });
    expect(batches[0]?.some((v) => result.observedVins.includes(v.vin))).toBe(
      false,
    );
    const resumed = await Effect.runPromise(
      streamDutchersInventoryWithRequestGate(
        {
          startCursor: result.cursor,
          readPage: input.readPage,
          onBatch: () => Effect.fail("duplicate emission"),
        },
        gate,
      ),
    );
    expect(resumed.count).toBe(0);
    expect(input.calls).toHaveLength(100);
  });

  // The 100-control serialized checkpoint replay can exceed five seconds in CI.
  test("resumes one native GET per checksum-protected checkpoint without partial emission", async () => {
    const input = reader();
    let emitted = 0;
    const result = await replay(
      input,
      (vehicles) =>
        Effect.sync(() => {
          expect(input.calls).toHaveLength(100);
          emitted += vehicles.length;
        }),
      1,
    );
    expect(result.status).toBe("complete");
    expect(emitted).toBe(579);
  }, 15_000);

  test("requires both full orders and the independent total despite repeated native page destinations", () => {
    expect(() => dutchersRoster(pages().slice(0, 24), 587)).toThrow("page");
    expect(() => dutchersRoster(pages(), 588)).toThrow();
    expect(roster()).toHaveLength(587);
    expect(dutchersHash(roster())).toBe(
      dutchersHash(dutchersRoster(pages(true), 587)),
    );
    expect(() =>
      parseDutchersCatalog(
        raw(2).replaceAll("page=24", "page=23"),
        "DESC",
        1,
        587,
      ),
    ).toThrow("pagination");
    expect(() =>
      parseDutchersCatalog(raw(2).replace("</html>", ""), "DESC", 1, 587),
    ).toThrow("truncated");
  });

  test("keeps scope uncertainty in the rejection denominator and preserves native reasons and valid identity", () => {
    const snapshot = dutchersSnapshot(roster(), scope());
    const uncertain = snapshot.rejects.filter(
      (r) => r.reason === "unresolved-native-scope",
    );
    expect(uncertain.map((r) => r.record.id).sort()).toEqual([
      "11208",
      "11482",
      "9015",
      "9226",
    ]);
    expect(
      uncertain.every(
        (r) =>
          r.vin !== null && r.nativeReason?.startsWith("FOR SALE. $95,000"),
      ),
    ).toBe(true);
    expect(
      snapshot.rejects
        .filter((r) => r.reason === "required-identity")
        .map((r) => [r.record.id, r.record.vin])
        .sort(),
    ).toEqual([
      ["5309", "1FUJAHAV71J07100"],
      ["596", "1XPALBOX1PN332805"],
      ["702", "1GBJ6C136F407393"],
    ]);
    expect(snapshot.accounting.recordsExcluded).toBe(0);
    expect(
      snapshot.accounting.recordsRejected /
        snapshot.accounting.recordsProcessed,
    ).toBeLessThan(0.1);
  });

  test("retains native item-bound photos and nulls vendor logos without deriving stock from tag", () => {
    const records = roster(),
      snapshot = dutchersSnapshot(records, scope());
    const native = records.find((r) => r.id === "12872");
    if (!native) throw new Error("Missing actual HX520 donor");
    expect(native.imageUrl).toContain("_3987345_1_12872_1.webp");
    expect(
      snapshot.vehicles.find((v) => v.vin === native.vin)?.stockNumber,
    ).toBeNull();
    expect(records.some((r) => r.imageUrl === null)).toBe(true);
    expect(
      DutchersRecordSchema.safeParse({
        ...native,
        imageUrl: "https://other.example/photo.jpg",
      }).success,
    ).toBe(false);
    expect(() =>
      parseDutchersCatalog(
        raw(2).replaceAll("/3987345/1/", "/3987345/2/"),
        "DESC",
        1,
        587,
      ),
    ).toThrow("foreign");
  });

  test("fails required-field, duplicate and conflicting-VIN quality without invented values", () => {
    const records = roster(),
      base = first();
    expect(() =>
      dutchersSnapshot(
        records.map((r, i) => (i < 60 ? { ...r, vin: "missing" } : r)),
        scope(),
      ),
    ).toThrow("rejection");
    expect(() =>
      dutchersSnapshot(
        records.slice(0, 20).map((r) => ({
          ...r,
          year: base.year,
          make: base.make,
          model: base.model,
          vin: base.vin,
        })),
        scope(),
      ),
    ).toThrow("duplicate");
    expect(() =>
      dutchersSnapshot([base, { ...base, id: "99999", year: "2001" }], scope()),
    ).toThrow("conflict");
  });

  test("rejects checkpoint corruption and missing page prefixes before issuing any request", async () => {
    expect(
      DutchersCursorSchema.safeParse({
        ...DutchersCursor.initial(),
        startedAt: 1,
      }).success,
    ).toBe(false);
    expect(() =>
      DutchersCursor.checkpoint({
        ...DutchersCursor.initial(),
        phase: "opening",
        total: 587,
        scope: scope(),
        pages: [
          { ...pages()[0], direction: "DESC", page: 2, records: [first()] },
        ],
      }),
    ).toThrow("prefix");
    const input = reader();
    await expect(
      Effect.runPromise(
        streamDutchersInventoryWithRequestGate(
          { maxPages: 0, readPage: input.readPage, onBatch: () => Effect.void },
          gate,
        ),
      ),
    ).rejects.toThrow("budget");
    expect(input.calls).toHaveLength(0);
  });

  test("aborts changed closing identities without emitting the otherwise valid opening roster", async () => {
    const vin = first().vin;
    const input = reader((body, index) =>
      index === 50 ? body.replace(vin, "1HTMMAAL78H000001") : body,
    );
    let emitted = 0;
    await expect(
      replay(input, (vehicles) =>
        Effect.sync(() => {
          emitted += vehicles.length;
        }),
      ),
    ).rejects.toThrow();
    expect(emitted).toBe(0);
  });

  test("aborts an altered closing scope assertion or unsupported explicit retail cohort", async () => {
    const input = reader((body, index) =>
      index === 99
        ? body.replaceAll(
            "vehicles purchased for Parts",
            "vehicles purchased for Retail",
          )
        : body,
    );
    let emitted = 0;
    await expect(
      replay(input, (vehicles) =>
        Effect.sync(() => {
          emitted += vehicles.length;
        }),
      ),
    ).rejects.toThrow("scope");
    expect(emitted).toBe(0);
    expect(() =>
      parseDutchersScope(
        raw(0).replaceAll(
          "2020 Freightliner M2 106",
          "2021 Freightliner M2 106",
        ),
      ),
    ).toThrow("retail/rebuildable");
  });

  test("HTTP boundary preserves 403, never retries, and rejects unrelated URLs before fetch", async () => {
    const fetcher = spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Access denied", {
        status: 403,
        headers: { "Content-Type": "text/html" },
      }),
    );
    try {
      await expect(
        Effect.runPromise(fetchDutchersPage(DUTCHERS_STORE, gate)),
      ).rejects.toThrow("403");
      expect(fetcher).toHaveBeenCalledTimes(1);
      await expect(
        Effect.runPromise(
          fetchDutchersPage(
            "https://www.heavytruckparts.net/search.php?fltpc=2141372&store=1",
            gate,
          ),
        ),
      ).rejects.toThrow("outside");
      expect(fetcher).toHaveBeenCalledTimes(1);
    } finally {
      fetcher.mockRestore();
    }
  });
});
