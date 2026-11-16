import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { z } from "zod";
import { Effect } from "effect";
import { parseBudgetPage } from "./budget-parser";
import { BudgetCursor } from "./budget-cursor";
import { budgetSnapshot, validateBudgetSnapshot } from "./budget-transform";
import { streamBudgetInventory } from "./budget-connector";
import { BudgetProviderError } from "./budget-client";
import { budgetPageUrl } from "./budget-yard-metadata";
const samples = z
  .record(z.string())
  .parse(
    JSON.parse(
      gunzipSync(
        readFileSync(
          new URL("./budget-test-fixtures/samples.json.gz", import.meta.url),
        ),
      ).toString(),
    ),
  );
const fixture = (name: string) => {
  const raw = samples[name];
  if (raw === undefined) throw new Error("Missing offline fixture " + name);
  return raw;
};
const directory = () => parseBudgetPage(fixture("directory"), "");
const ford = () => parseBudgetPage(fixture("ford"), "FORD");
describe("Budget complete native make census", () => {
  test("reconciles the complete make selector with its independent model map and observed donor fields", () => {
    expect(directory().makes).toHaveLength(38);
    expect(ford().records.length).toBeGreaterThan(250);
    expect(
      parseBudgetPage(fixture("chevrolet"), "CHEVROLET").records.length,
    ).toBeGreaterThan(200);
    for (const raw of [
      fixture("ford").replace("<option value='FORD'>FORD</option>", ""),
      fixture("ford").replace('"FORD":[', '"FOREIGN":[ '),
      fixture("ford").replace(
        'data-label="Make">FORD',
        'data-label="Make">FOREIGN',
      ),
      fixture("ford").replace('data-label="Model">', 'data-label="Changed">'),
      fixture("ford").replace("</html>", ""),
      fixture("ford").replaceAll("881 South 9th Street", "different address"),
      fixture("ford").replace(
        "</table>",
        '</table><a rel="next" href="?page=2">Next</a>',
      ),
    ])
      expect(() => parseBudgetPage(raw, "FORD")).toThrow();
    expect(() => parseBudgetPage(fixture("ford"), "CHEVROLET")).toThrow();
  });
  test("rejects malformed VINs without inventing identity and preserves native optional metadata", () => {
    const page = parseBudgetPage(fixture("chevrolet"), "CHEVROLET");
    const snapshot = budgetSnapshot(page.records);
    expect(snapshot.accounting.recordsRejected).toBeGreaterThanOrEqual(2);
    expect(snapshot.accounting.recordsExcluded).toBe(0);
    const record = ford().records[0];
    if (!record) throw new Error("Missing fixture donor");
    const valid = budgetSnapshot([record]);
    expect(valid.vehicles).toHaveLength(1);
    expect(valid.vehicles[0]).toMatchObject({
      locationCode: "winter-garden",
      stateAbbr: "FL",
      stockNumber: record.stock,
      row: record.row,
      imageUrl: null,
      color: null,
    });
    const optional = budgetSnapshot([
      { ...record, stock: "", row: "", date: "invalid" },
    ]);
    expect(optional.vehicles[0]).toMatchObject({
      stockNumber: null,
      row: null,
      availableDate: null,
    });
    expect(
      budgetSnapshot([{ ...record, vin: "11111111111111111" }]).accounting
        .recordsRejected,
    ).toBe(1);
    expect(
      budgetSnapshot([record, { ...record, model: "DIFFERENT" }]),
    ).toMatchObject({
      vehicles: [],
      accounting: { recordsRejected: 2 },
      observedVins: [record.vin],
    });
    expect(() => validateBudgetSnapshot(valid)).toThrow("floor");
  });
  test("persists the exact native make prefix and rejects false completion, directory drift and tampering", async () => {
    const requested: string[] = [];
    let emitted = 0;
    const result = await Effect.runPromise(
      streamBudgetInventory({
        maxPages: 2,
        readPage: (url) => {
          requested.push(url);
          if (url === budgetPageUrl(""))
            return Effect.succeed(fixture("directory"));
          if (url === budgetPageUrl("ACURA")) {
            const raw = fixture("ford").replaceAll(">FORD</td>", ">ACURA</td>");
            return Effect.fail(
              new BudgetProviderError(
                "offline",
                "No ACURA sample in this small fixture: " + raw.length,
              ),
            );
          }
          return Effect.fail(
            new BudgetProviderError("offline", "Unexpected URL " + url),
          );
        },
        onBatch: (v) =>
          Effect.sync(() => {
            emitted += v.length;
          }),
      }).pipe(Effect.either),
    );
    expect(result._tag).toBe("Left");
    expect(requested).toEqual([budgetPageUrl(""), budgetPageUrl("ACURA")]);
    expect(emitted).toBe(0);
    const initial = BudgetCursor.initial();
    const opening = BudgetCursor.checkpoint({
      ...initial,
      phase: "opening",
      pages: [directory()],
      closed: 0,
    });
    expect(BudgetCursor.fromWire(BudgetCursor.serialize(opening))).toEqual(
      opening,
    );
    expect(() =>
      BudgetCursor.checkpoint({ ...opening, phase: "closing" }),
    ).toThrow("prefix");
    expect(() =>
      BudgetCursor.checkpoint({ ...opening, pages: [directory(), ford()] }),
    ).toThrow("prefix");
    expect(() =>
      BudgetCursor.fromWire(
        BudgetCursor.serialize(opening).replace('"closed":0', '"closed":1'),
      ),
    ).toThrow();
    expect(() =>
      BudgetCursor.fromWire(" ".repeat(8 * 1024 * 1024 + 1)),
    ).toThrow("8 MiB");
  });
  test("complete checkpoint never requests inventory twice", async () => {
    const cursor = BudgetCursor.checkpoint({
      ...BudgetCursor.initial(),
      phase: "complete",
    });
    const result = await Effect.runPromise(
      streamBudgetInventory({
        startCursor: cursor,
        readPage: () => {
          throw new Error("No network allowed");
        },
        onBatch: () => {
          throw new Error("Already complete");
        },
      }),
    );
    expect(result.status).toBe("complete");
    expect(result.pagesProcessed).toBe(0);
  });
});
