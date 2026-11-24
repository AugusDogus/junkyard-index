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
import {
  HOLLANDERSTORES_YARDS,
  type HollanderstoresYard,
} from "./hollanderstores-yard-metadata";
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
}, 300000);

test("a yard whose closing census drifts keeps its previous inventory while the other yards publish", async () => {
  const opening = pages();
  for (const code of ["piperautoparts", "aabcoautoparts"]) {
    const index = HOLLANDERSTORES_YARDS.findIndex((yard) => yard.code === code);
    opening[index] = parseHollanderstoresPage(
      fixture(code + "-initial"),
      index,
    );
  }
  const drifted = HOLLANDERSTORES_YARDS[0];
  if (!drifted) throw new Error("Missing first Hollander yard");
  const first = opening[0];
  if (!first) throw new Error("Missing saved first-yard census");
  // Four replaced destinations change eight identities, above its bound.
  let closing = fixture(drifted.code + "-closing");
  for (const [index, row] of first.rows.slice(0, 4).entries())
    closing = closing.replace(
      new URL(row.url).pathname,
      `/VehicleDealerShowParts/${drifted.tenant}/${90000000 + index}`,
    );
  const expected = hollanderstoresSnapshot(
    opening,
    hollanderstoresSeed,
    null,
    new Set([drifted.code]),
  );
  expect(expected.errors).toEqual([]);
  expect(expected.rejectedYards).toEqual([]);
  let cursor = closingCursor(opening);
  const batches: HollanderstoresVehicle[][] = [];
  while (cursor.phase !== "complete") {
    const result = await Effect.runPromise(
      streamHollanderstoresInventory({
        startCursor: cursor,
        maxPages: 8,
        decodeBatch: () => Effect.die("Opening VINs are already decoded"),
        readPage: (yard) =>
          Effect.sync(() =>
            yard.code === drifted.code
              ? closing
              : fixture(
                  yard.code +
                    (yard.code === "bandmauto" ? "-initial" : "-closing"),
                ),
          ),
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
  }
  expect(batches).toEqual([expected.vehicles]);
  expect(
    batches.flat().some((vehicle) => vehicle.locationCode === drifted.code),
  ).toBe(false);
  expect(cursor.preserved?.map((yard) => yard.code)).toEqual([drifted.code]);
  expect(cursor.preserved?.[0]?.reason).toContain(
    `${drifted.code} closing census drift`,
  );
}, 300000);

test("a census that drifts in every yard fails once without publishing", async () => {
  // One saved-shape card per yard; only the stock changes between censuses.
  const response = (yard: HollanderstoresYard, stock: string) =>
    `<html><body><a class="hpdcLogo">${yard.logo.replaceAll("&", "&amp;")}</a>
      <p>Showing 1 Vehicles in Inventory</p><div class="individualPartHolder">
      <span>&#39;13 ACURA RDX</span><li>VIN 5J8TB4H35DL015046</li><li>Stock# ${stock}</li>
      <a href="/VehicleDealerShowParts/${yard.tenant}/1">View Parts</a></div></body></html>`;
  const opening = HOLLANDERSTORES_YARDS.map((yard, index) =>
    parseHollanderstoresPage(response(yard, "opening"), index),
  );
  const start = closingCursor(opening);
  let cursor = start;
  let reads = 0;
  for (;;) {
    const result = await Effect.runPromise(
      streamHollanderstoresInventory({
        startCursor: cursor,
        maxPages: 8,
        decodeBatch: () => Effect.die("No decode during closing"),
        readPage: (yard) =>
          Effect.sync(() => {
            reads++;
            return response(yard, "closing");
          }),
        onBatch: () =>
          Effect.die("A census with no closed yard cannot publish"),
      }),
    );
    if (result.status === "paused") {
      cursor = result.cursor;
      continue;
    }
    expect(result.status).toBe("failed");
    // The census drifted while it was read, so a crawl later today can pass.
    expect(result).toMatchObject({ failureKind: "transient" });
    expect(result.errors).toHaveLength(HOLLANDERSTORES_YARDS.length);
    expect(result.errors.join(" ")).toContain(
      "closing census changed surviving vehicle fields",
    );
    expect(result.count).toBe(0);
    break;
  }
  expect(reads).toBe(HOLLANDERSTORES_YARDS.length);
});

test("census turnover accepts the exact per-yard limit and rejects one more removal", () => {
  for (const code of ["aabcoautoparts", "bandmauto"]) {
    const index = HOLLANDERSTORES_YARDS.findIndex((yard) => yard.code === code);
    const page = parseHollanderstoresPage(fixture(code), index);
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

test("census survivor rejections name the yard, first differing url and changed fields", () => {
  const index = HOLLANDERSTORES_YARDS.findIndex(
    (yard) => yard.code === "bandmauto",
  );
  const page = parseHollanderstoresPage(fixture("bandmauto"), index);
  const [first, second, ...rest] = page.rows;
  if (!first || !second) throw new Error("Expected two saved bandmauto rows");
  const changed = hollanderstoresCensusError(page, {
    ...page,
    rows: [
      first,
      { ...second, imageUrl: "https://example.com/new.jpg" },
      ...rest,
    ],
  });
  expect(changed).toContain("bandmauto closing census changed");
  expect(changed).toContain(
    '1 surviving vehicle changed fields, first https://bandmauto.hollanderstores.com/VehicleDealerShowParts/450/71394115 changed imageUrl from "https://d1vnbry5hm94g5.cloudfront.net/7T/JA/ZL/GL/P-T.jpg" to "https://example.com/new.jpg"',
  );
  expect(changed).toContain(`1 of ${page.rows.length} surviving positions`);
  const reordered = hollanderstoresCensusError(page, {
    ...page,
    rows: [second, first, ...rest],
  });
  expect(reordered).toContain("no surviving vehicle fields changed");
  expect(reordered).toContain(
    'order changed, first at surviving position 0: opening has https://bandmauto.hollanderstores.com/VehicleDealerShowParts/450/59713736 (stock "972023", VIN "1GNEK13RXVJ409373"), closing has https://bandmauto.hollanderstores.com/VehicleDealerShowParts/450/71394115 (stock "246021", VIN "3VVMB7AX1RM050109"), different stocks',
  );
  expect(reordered).toContain(`2 of ${page.rows.length} surviving positions`);
  const sharedStock = { ...second, stock: first.stock };
  const tieReordered = hollanderstoresCensusError(
    { ...page, rows: [first, sharedStock, ...rest] },
    { ...page, rows: [sharedStock, first, ...rest] },
  );
  expect(tieReordered).toContain(
    '(stock "972023", VIN "3VVMB7AX1RM050109"), same stock',
  );
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
