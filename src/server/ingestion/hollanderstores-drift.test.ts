import { expect, test } from "bun:test";
import { Effect } from "effect";
import { streamHollanderstoresInventory } from "./hollanderstores-connector";
import { hollanderstoresSeed } from "./hollanderstores-client";
import {
  HollanderstoresCursor,
  hollanderstoresMissing,
} from "./hollanderstores-cursor";
import {
  parseHollanderstoresPage,
  type HollanderstoresPage,
} from "./hollanderstores-parser";
import {
  hollanderstoresSnapshot,
  type HollanderstoresVehicle,
} from "./hollanderstores-snapshot";
import { HOLLANDERSTORES_YARDS } from "./hollanderstores-yard-metadata";
import { hollanderstoresCensusError } from "./hollanderstores-census";
import wd2 from "./hollanderstores-test-fixtures/wd2-wmi.json";
import {
  hollanderstoresFixture as fixture,
  hollanderstoresFixturePages as pages,
} from "./hollanderstores-test-fixtures";

function closingCursor(opening: HollanderstoresPage[]) {
  const needed = hollanderstoresMissing({ pages: opening });
  const { checksum, ...initial } = HollanderstoresCursor.initial();
  expect(checksum).toBeString();
  return HollanderstoresCursor.checkpoint({
    ...initial,
    phase: "closing",
    closed: 0,
    startedAt: Date.now(),
    pages: opening,
    decoded: Object.fromEntries(
      needed.map((vin) => [vin, hollanderstoresSeed[vin] ?? null]),
    ),
    requests: opening.length + Math.ceil(needed.length / 50),
  });
}

test("publishes the observed opening set after saved one-vehicle additions and removals", async () => {
  const opening = pages();
  for (const code of ["piperautoparts", "aabcoautoparts"]) {
    const index = HOLLANDERSTORES_YARDS.findIndex((yard) => yard.code === code);
    opening[index] = parseHollanderstoresPage(
      fixture(code + "-initial"),
      index,
    );
  }
  const expected = hollanderstoresSnapshot(opening, hollanderstoresSeed);
  expect(expected.errors).toEqual([]);
  let cursor = closingCursor(opening);
  const batches: HollanderstoresVehicle[][] = [];
  let reads = 0;
  while (cursor.phase !== "complete") {
    const result = await Effect.runPromise(
      streamHollanderstoresInventory({
        startCursor: cursor,
        maxPages: 8,
        decodeBatch: () => Effect.die("Opening VINs are already decoded"),
        readPage: (yard) =>
          Effect.sync(() => {
            reads++;
            return fixture(
              yard.code + (yard.code === "bandmauto" ? "-initial" : "-closing"),
            );
          }),
        onBatch: (vehicles) =>
          Effect.sync(() => {
            batches.push(vehicles);
          }),
      }),
    );
    expect(result.status).not.toBe("failed");
    cursor = HollanderstoresCursor.fromWire(
      HollanderstoresCursor.serialize(result.cursor),
    );
    if (result.status === "paused") expect(batches).toHaveLength(0);
  }
  expect(reads).toBe(HOLLANDERSTORES_YARDS.length);
  expect(batches).toEqual([expected.vehicles]);
}, 180000);

test("large identity turnover with an unchanged count fails once without publishing", async () => {
  const opening = pages();
  const yard = HOLLANDERSTORES_YARDS[0];
  const raw = fixture(yard.code);
  // Four replacements change eight identities, above this yard's five-row bound.
  const destinations = opening[0]?.rows.slice(0, 4) ?? [];
  let changed = raw;
  for (const [index, row] of destinations.entries()) {
    changed = changed.replace(
      new URL(row.url).pathname,
      `/VehicleDealerShowParts/${yard.tenant}/${90000000 + index}`,
    );
  }
  let reads = 0;
  const cursor = closingCursor(opening);
  const result = await Effect.runPromise(
    streamHollanderstoresInventory({
      startCursor: cursor,
      maxPages: 8,
      decodeBatch: () => Effect.die("No decode during closing"),
      readPage: () =>
        Effect.sync(() => {
          reads++;
          return changed;
        }),
      onBatch: () => Effect.die("Excessive turnover cannot publish"),
    }),
  );
  expect(result.status).toBe("failed");
  expect(result.errors.join(" ")).toContain("closing census drift");
  expect(result.cursor).toEqual(cursor);
  expect(result.count).toBe(0);
  expect(reads).toBe(1);
});

test("census turnover accepts the exact per-yard limit and rejects one more removal", () => {
  const opening = pages();
  for (const code of ["aabcoautoparts", "bandmauto"]) {
    const page = opening.find((page) => page.yard === code);
    if (!page) throw new Error("Missing saved yard " + code);
    const limit = code === "aabcoautoparts" ? 53 : 3;
    const closing = {
      ...page,
      total: page.total - limit,
      rows: page.rows.slice(limit),
    };
    expect(hollanderstoresCensusError(page, closing)).toBeNull();
    expect(
      hollanderstoresCensusError(page, {
        ...closing,
        total: closing.total - 1,
        rows: closing.rows.slice(1),
      }),
    ).toContain(`exceeds ${limit} vehicles`);
  }
});

test("Sprinter decodes publish a WMI make while native makes retain priority", () => {
  expect(wd2.SearchCriteria).toBe("WMI:WD2");
  expect(wd2.Results.flatMap((row) => row.Make.split(", "))).toContain(
    "FREIGHTLINER",
  );
  const opening = pages();
  const vins = ["WD2YD642X35490605", "WD2PD644845638085"];
  const snapshot = hollanderstoresSnapshot(opening, hollanderstoresSeed);
  for (const vin of vins) {
    expect(snapshot.vehicles.find((vehicle) => vehicle.vin === vin)?.make).toBe(
      "Freightliner",
    );
    const row = opening
      .flatMap((page) => page.rows)
      .find((row) => row.vin === vin);
    if (!row) throw new Error("Missing saved Sprinter row " + vin);
    row.make = "DODGE";
  }
  const native = hollanderstoresSnapshot(opening, hollanderstoresSeed);
  for (const vin of vins)
    expect(native.vehicles.find((vehicle) => vehicle.vin === vin)?.make).toBe(
      "Dodge",
    );
});
