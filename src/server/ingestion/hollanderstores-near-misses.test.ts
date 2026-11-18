import { expect, spyOn, test } from "bun:test";
import { Effect } from "effect";
import {
  hollanderstoresFixtureBody as body,
  hollanderstoresFixturePages as pages,
} from "./hollanderstores-test-fixtures";
import { HOLLANDERSTORES_YARDS } from "./hollanderstores-yard-metadata";
import { parseHollanderstoresRoster } from "./hollanderstores-parser";
import { hollanderstoresCensusError } from "./hollanderstores-census";
import { hollanderstoresSnapshot } from "./hollanderstores-snapshot";
import { hollanderstoresMissing } from "./hollanderstores-cursor";
import {
  hollanderstoresSeed,
  decodeHollanderstoresBatch,
} from "./hollanderstores-client";
import { hollanderstoresVin } from "./hollanderstores-vin";
import { beaversText } from "./beavers-html";
import { stripInventoryRawText } from "./inventory-html";
import { z } from "zod";

const yard = HOLLANDERSTORES_YARDS.find((yard) => yard.code === "waugh");
if (!yard) throw new Error("Waugh must be configured");

test("Waugh reconciles all 123 donors and admits them through the unchanged connector", () => {
  const opening = parseHollanderstoresRoster(body("waugh.html.gz"), yard);
  const closing = parseHollanderstoresRoster(
    body("waugh-closing.html.gz"),
    yard,
  );
  expect(opening.total).toBe(123);
  expect(opening.rows).toEqual(closing.rows);
  expect(hollanderstoresCensusError(opening, closing)).toBeNull();
  expect(
    opening.rows.every((row) => hollanderstoresVin(row.vin) === row.vin),
  ).toBe(true);
  const snapshot = hollanderstoresSnapshot(pages(), hollanderstoresSeed);
  expect(snapshot.errors).toEqual([]);
  expect(snapshot.perYard.find((row) => row.code === yard.code)).toEqual({
    code: "waugh",
    total: 123,
    accepted: 123,
    rejected: 0,
    duplicates: 0,
  });
  expect(yard.minimum).toBe(41);
  expect(
    snapshot.vehicles
      .filter((row) => row.locationCode === yard.code)
      .every((row) => row.availableDate === null),
  ).toBe(true);
});

test("Waugh's actual newest-donor part supplies recent acquisition evidence", () => {
  const roster = parseHollanderstoresRoster(body("waugh.html.gz"), yard);
  const newest = [...roster.rows].sort(
    (a, b) => Number(b.url.split("/").at(-1)) - Number(a.url.split("/").at(-1)),
  )[0];
  expect(newest).toMatchObject({
    vin: "3GNEC12018G104236",
    stock: "264382",
    displayYear: "'08",
  });
  expect(newest?.url).toEndWith("/4000/72794631");
  const part = beaversText(
    stripInventoryRawText(body("waugh-newest-part.html.gz")),
  );
  expect(part).toContain("Year Model 2008 AVALNCH15");
  expect(part).toContain("VIN 3GNEC12018G104236");
  expect(part).toContain("Stock # 264382");
  expect(part).toContain("Date Acquired 11/11/2026 6:00:00 AM");
});

test("Waugh decodes only valid VINs with missing native makes in one batch", async () => {
  const page = parseHollanderstoresRoster(body("waugh.html.gz"), yard);
  const missing = hollanderstoresMissing({ pages: [page] });
  expect(missing).toHaveLength(24);
  const fetchMock = spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(body("waugh-vpic.json.gz"), {
      headers: { "content-type": "application/json" },
    }),
  );
  try {
    const decoded = await Effect.runPromise(
      decodeHollanderstoresBatch(missing, (request) => request),
    );
    for (const vin of missing)
      expect(decoded[vin]).toBe(hollanderstoresSeed[vin]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  } finally {
    fetchMock.mockRestore();
  }
});

test("Waugh's published physical location matches the Census address", () => {
  const about = beaversText(stripInventoryRawText(body("waugh-about.html.gz")));
  expect(about).toContain("2315 Morrisville Road Anniston, AL 36201");
  expect(about).toContain(yard.phone ?? "missing phone");
  const geocode = z
    .object({
      result: z.object({
        addressMatches: z.array(
          z.object({
            matchedAddress: z.string(),
            coordinates: z.object({ x: z.number(), y: z.number() }),
          }),
        ),
      }),
    })
    .parse(JSON.parse(body("waugh-geocode.json.gz")));
  expect(geocode.result.addressMatches).toContainEqual(
    expect.objectContaining({
      matchedAddress: "2315 MORRISVILLE RD, ANNISTON, AL, 36201",
      coordinates: { x: yard.lng, y: yard.lat },
    }),
  );
});
