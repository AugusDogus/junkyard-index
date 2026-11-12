import { expect, test } from "bun:test";
import {
  parseLittletonAnalytics,
  parseLittletonConfig,
  parseLittletonInventory,
  parseLittletonOwner,
  parseLittletonSearch,
} from "./littleton-parser";
import {
  littletonTestAnalytics,
  littletonTestConfig,
  littletonTestInventory,
  littletonTestOwner,
  littletonTestRecord,
  littletonTestSearch,
} from "./littleton-test-fixtures";

test("Littleton binds a complete official table to native year counts and exact pairs", () => {
  parseLittletonOwner(littletonTestOwner);
  parseLittletonConfig(littletonTestConfig);
  const table = parseLittletonInventory(littletonTestInventory());
  expect(table.rows).toHaveLength(1);
  expect(table.pairs).toEqual([{ make: "ACURA", model: "MDX" }]);
  expect(parseLittletonAnalytics(littletonTestAnalytics())).toEqual({
    count: 1,
    years: [{ year: 2005, count: 1 }],
  });
  expect(
    parseLittletonSearch(
      littletonTestSearch(),
      table.pairs[0] ?? { make: "", model: "" },
    ),
  ).toHaveLength(1);
});

test.each([
  ["truncated document", (body: string) => body.replace("</html>", "")],
  ["truncated row", (body: string) => body.replace("</td>", "")],
  [
    "second unclosed inventory table",
    (body: string) =>
      body.replace(
        "</body>",
        '<table class="table-parts"><tbody><tr><td>MORE</td></tr></tbody></body>',
      ),
  ],
  [
    "extra cell",
    (body: string) =>
      body.replace("</tr></tbody>", "<td>EXTRA</td></tr></tbody>"),
  ],
  ["missing stock", (body: string) => body.replace("STK056374", "")],
  ["changed header", (body: string) => body.replace("Stock#", "ID")],
] as const)("Littleton rejects %s", (_label, rewrite) => {
  expect(() =>
    parseLittletonInventory(rewrite(littletonTestInventory())),
  ).toThrow();
});

test("Littleton validates exact response criteria and complete match counts", () => {
  const pair = { make: "ACURA", model: "MDX" };
  expect(() =>
    parseLittletonSearch(
      littletonTestSearch().replace('"match_count":1', '"match_count":2'),
      pair,
    ),
  ).toThrow();
  expect(() =>
    parseLittletonSearch(
      littletonTestSearch().replace(
        '"model":"MDX","yard_id"',
        '"model":"TL","yard_id"',
      ),
      pair,
    ),
  ).toThrow();
  expect(() =>
    parseLittletonSearch(
      littletonTestSearch().replace(
        '"yardLocation":"Littleton U-Pull-It"',
        '"yardLocation":"Other Yard"',
      ),
      pair,
    ),
  ).toThrow();
});

test("Littleton optional table position and source date can be absent or unusable", () => {
  const table = parseLittletonInventory(
    littletonTestInventory()
      .replace("<td>35</td>", "<td>Unknown</td>")
      .replace("11.04.26", "02.30.26"),
  );
  expect(table.rows[0]).toMatchObject({ row: null, date: null });
});

test("Littleton refuses duplicate stocks, foreign embeds and demo or multi-yard config", () => {
  expect(() =>
    parseLittletonInventory(
      littletonTestInventory([littletonTestRecord, littletonTestRecord]),
    ),
  ).toThrow("stock");
  expect(() =>
    parseLittletonOwner(
      littletonTestOwner.replace("parts/littleton", "parts/other"),
    ),
  ).toThrow();
  expect(() =>
    parseLittletonConfig(
      littletonTestConfig.replace(
        '"demo_freshness_enabled":false',
        '"demo_freshness_enabled":true',
      ),
    ),
  ).toThrow();
  expect(() =>
    parseLittletonConfig(
      littletonTestConfig.replace(
        '"multi_location_enabled":false',
        '"multi_location_enabled":true',
      ),
    ),
  ).toThrow();
  expect(() =>
    parseLittletonAnalytics(
      littletonTestAnalytics().replace(
        '"current_count":1',
        '"current_count":2',
      ),
    ),
  ).toThrow();
});
