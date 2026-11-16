import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { brotliDecompressSync } from "node:zlib";
import { createHash } from "node:crypto";
import { Effect } from "effect";
import { z } from "zod";
import { BudgetCursor } from "./budget-cursor";
import { streamBudgetInventory } from "./budget-connector";
import { BudgetProviderError } from "./budget-client";
import { parseBudgetPage } from "./budget-parser";
import { budgetSnapshot, validateBudgetSnapshot } from "./budget-transform";
import { BUDGET_MINIMUM } from "./budget-yard-metadata";
import { inventoryVinWithCheckDigit } from "./inventory-vin-check-digit";
import { validateSourceSnapshot } from "./source-validation";
import type { CanonicalVehicle } from "./types";
const receipts = z
  .array(z.object({ url: z.string(), raw: z.string(), sha256: z.string() }))
  .parse(
    JSON.parse(
      brotliDecompressSync(
        readFileSync(
          new URL("./budget-test-fixtures/native.json.br", import.meta.url),
        ),
      ).toString(),
    ),
  );
async function replay(change?: (raw: string, index: number) => string) {
  let cursor = BudgetCursor.initial(),
    index = 0,
    maxBytes = 0;
  const vehicles: CanonicalVehicle[] = [];
  const yards: string[] = [];
  let accounting = {
    recordsProcessed: 0,
    recordsRejected: 0,
    recordsExcluded: 0,
    duplicateVehicles: 0,
  };
  while (cursor.phase !== "complete") {
    const result = await Effect.runPromise(
      streamBudgetInventory({
        startCursor: cursor,
        maxPages: 8,
        readPage: (url) =>
          Effect.try({
            try: () => {
              const receipt = receipts[index];
              if (!receipt || receipt.url !== url)
                throw new Error(`Unexpected offline request ${index}: ${url}`);
              expect(
                createHash("sha256").update(receipt.raw).digest("hex"),
              ).toBe(receipt.sha256);
              const raw = change ? change(receipt.raw, index) : receipt.raw;
              index++;
              return raw;
            },
            catch: (cause) =>
              new BudgetProviderError("offline fixture replay", cause),
          }),
        onBatch: (batch) =>
          Effect.sync(() => {
            vehicles.push(...batch);
          }),
        onYards: (batch) =>
          Effect.sync(() => {
            yards.push(...batch.map((y) => y.code));
          }),
      }),
    );
    const wire = BudgetCursor.serialize(result.cursor);
    maxBytes = Math.max(maxBytes, Buffer.byteLength(wire));
    cursor = BudgetCursor.fromWire(wire);
    accounting = result.accounting;
    if (result.status === "paused") {
      expect(vehicles).toHaveLength(0);
      expect(result.count).toBe(0);
    }
  }
  return { cursor, vehicles, yards, index, maxBytes, accounting };
}
test("Budget replays every independently acquired opening and closing make response through durable resumes without network", async () => {
  const r = await replay();
  expect(r.index).toBe(78);
  expect(r.maxBytes).toBeLessThan(400_000);
  expect(r.vehicles).toHaveLength(1606);
  expect(r.yards).toEqual(["winter-garden"]);
  expect(new Set(r.vehicles.map((v) => v.vin)).size).toBe(1606);
  expect(r.accounting).toEqual({
    recordsProcessed: 1619,
    recordsRejected: 13,
    recordsExcluded: 0,
    duplicateVehicles: 0,
  });
  for (const v of r.vehicles)
    expect(inventoryVinWithCheckDigit(v.vin, String(v.year))).toBe(v.vin);
  expect(
    validateSourceSnapshot({
      source: "budget",
      terminal: true,
      uniqueVehicles: r.vehicles.length,
      vehiclesProcessed: r.accounting.recordsProcessed,
      rejectedVehicles: r.accounting.recordsRejected,
      duplicateVehicles: 0,
      errors: [],
      previousAcceptedCount: null,
    }).status,
  ).toBe("accepted");
});
test("Budget aborts closing drift instead of emitting the saved opening inventory", async () => {
  await expect(
    replay((raw, index) =>
      index === 49
        ? raw.replace('data-label="Model">', 'data-label="Changed">')
        : raw,
    ),
  ).rejects.toThrow("field labels changed");
});

test("Budget admits one third of the saved census and rejects below its floor", () => {
  const rows = receipts
    .slice(1, 39)
    .flatMap(
      (receipt) =>
        parseBudgetPage(
          receipt.raw,
          new URL(receipt.url).searchParams.get("make") ?? "",
        ).records,
    );
  const accepted = new Set(
    budgetSnapshot(rows).vehicles.map((vehicle) => vehicle.vin),
  );
  const valid = rows.filter((record) => accepted.has(record.vin));
  expect(BUDGET_MINIMUM).toBe(535);
  expect(() =>
    validateBudgetSnapshot(budgetSnapshot(valid.slice(0, 534))),
  ).toThrow("floor");
  expect(() =>
    validateBudgetSnapshot(budgetSnapshot(valid.slice(0, 535))),
  ).not.toThrow();
});
