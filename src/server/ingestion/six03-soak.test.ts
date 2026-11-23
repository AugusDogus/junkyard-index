import { expect, test } from "bun:test";
import { ModelCensus } from "./model-census";
import { soakSix03Inventory } from "../../../scripts/soak-six03";
import type { Six03StreamResult } from "./six03-connector";
import { Six03Cursor } from "./six03-cursor";
import { parseSix03Contact } from "./six03-parser";
import { six03NativeFixtures } from "./six03-test-fixtures";

const cursor = Six03Cursor.checkpoint({
  ...Six03Cursor.initial,
  phase: "catalog",
  contact: parseSix03Contact(six03NativeFixtures().contact),
  requests: 1,
  day: ModelCensus.day(Date.parse("2026-11-22")),
});
const paused = (): Six03StreamResult => ({
  source: "six03",
  status: "paused",
  cursor,
  pagesProcessed: 1,
  count: 0,
  accounting: {
    recordsProcessed: 0,
    recordsExcluded: 0,
    recordsRejected: 0,
    duplicateVehicles: 0,
  },
  errors: [],
  warnings: [],
  observedVins: [],
});

test("603 soak validates total/chunk budgets before invoking its supplied driver", async () => {
  let calls = 0;
  const driver = async () => {
    calls++;
    return paused();
  };
  for (const [total, chunk] of [
    [0, 8],
    [1211, 8],
    [8, 9],
    [8, 0],
    [8, 1.5],
  ])
    await expect(soakSix03Inventory(driver, total, chunk)).rejects.toThrow(
      "requires",
    );
  expect(calls).toBe(0);
});

test("603 soak refuses paused count, accounting and VIN presence leakage", async () => {
  const bad: Six03StreamResult[] = [
    { ...paused(), count: 1 },
    { ...paused(), observedVins: ["2HGFC2F84LH570904"] },
    {
      ...paused(),
      accounting: { ...paused().accounting, recordsProcessed: 1 },
    },
  ];
  for (const chunk of bad)
    await expect(soakSix03Inventory(async () => chunk, 1, 1)).rejects.toThrow(
      "preterminal data",
    );
});

test("603 soak refuses excess page units, nonadvancing cursors and source request accounting mismatch", async () => {
  await expect(
    soakSix03Inventory(async () => ({ ...paused(), pagesProcessed: 2 }), 1, 1),
  ).rejects.toThrow("status");
  await expect(
    soakSix03Inventory(
      async () => ({ ...paused(), cursor: Six03Cursor.initial }),
      1,
      1,
    ),
  ).rejects.toThrow("request accounting");
  const summary = await soakSix03Inventory(async () => paused(), 1, 1);
  expect(summary.status).toBe("paused");
  expect(summary.count).toBe(0);
  expect(summary.pagesProcessed).toBe(1);
});
