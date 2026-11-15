import { expect, test } from "bun:test";
import { BeaversCursor, BeaversCursorSchema } from "./beavers-cursor";
import { advanceBeavers } from "./beavers-connector";
import { parseBeaversCatalog } from "./beavers-parser";
import { beaversFixture, beaversTestCatalog } from "./beavers-test-fixtures";
import { BEAVERS_CATALOG } from "./beavers-yard-metadata";

test("checkpoint round trips preserve joins and detect mutation without advancing native work", () => {
  const next = advanceBeavers(BeaversCursor.initial, {
    kind: "html",
    body: beaversFixture("first"),
  });
  expect(BeaversCursor.parse(BeaversCursor.serialize(next))).toEqual(next);
  expect(BeaversCursor.initial.pages).toEqual([]);
  expect(BeaversCursorSchema.safeParse({ ...next, pages: [] }).success).toBe(
    false,
  );
  expect(() => BeaversCursor.parse(" ".repeat(2 * 1024 * 1024 + 1))).toThrow(
    "2 MiB",
  );
});
test("recomputed checkpoints still reject skipped pages, premature donors and changed tenant redirects", () => {
  const page = parseBeaversCatalog(beaversFixture("first"), BEAVERS_CATALOG);
  expect(() =>
    BeaversCursor.checkpoint({
      ...BeaversCursor.initial,
      pages: [{ ...page, page: 2, url: `${BEAVERS_CATALOG}?page=2` }],
    }),
  ).toThrow("prefix");
  expect(() =>
    BeaversCursor.checkpoint({
      ...BeaversCursor.initial,
      phase: "route",
      pages: [page],
    }),
  ).toThrow("complete native roster");
  const route = advanceBeavers(BeaversCursor.initial, {
    kind: "html",
    body: beaversTestCatalog(1, 20),
  });
  expect(route.phase).toBe("route");
  expect(() =>
    advanceBeavers(route, {
      kind: "redirect",
      url: "https://foreign.example/VehiclePartSearch/503/10000000",
    }),
  ).toThrow("tenant or donor");
  expect(() =>
    advanceBeavers(route, {
      kind: "redirect",
      url: "https://beaversgarage.hollanderstores.com/VehiclePartSearch/504/10000000",
    }),
  ).toThrow("tenant or donor");
});
