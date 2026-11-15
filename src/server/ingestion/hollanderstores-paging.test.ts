import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { parseHollanderstoresRoster } from "./hollanderstores-parser";
import {
  HOLLANDERSTORES_YARDS,
  type HollanderstoresYard,
} from "./hollanderstores-yard-metadata";

const raw = gunzipSync(
  readFileSync(
    `${import.meta.dir}/hollanderstores-test-fixtures/expansion/aaaparts-page-1.html.gz`,
  ),
).toString();
const aaa: HollanderstoresYard = {
  ...HOLLANDERSTORES_YARDS[0],
  code: "aaaparts",
  tenant: "69",
  logo: "aaa auto parts",
  websiteUrl: "https://aaaparts.hollanderstores.com/",
};

test("native AAA list view has 20 rows, no make column and a checked next page", () => {
  const page = parseHollanderstoresRoster(raw, aaa);
  expect(page.total).toBe(17884);
  expect(page.rows).toHaveLength(20);
  expect(page.nextPage).toBe(2);
  expect(page.rows[0]).toEqual({
    displayYear: "'94",
    make: null,
    model: "CUT-SUPRE",
    stock: "PBS",
    vin: "1G3WH15M1RD340025",
    url: "https://aaaparts.hollanderstores.com/VehicleDealerShowParts/69/1119522",
  });
  expect(page.rows.every((row) => row.make === null)).toBe(true);
});

test("paged grammar rejects wrong positions, next links, row loss, foreign destinations and truncation", () => {
  expect(() => parseHollanderstoresRoster(raw, aaa, 2)).toThrow();
  for (const changed of [
    raw.replaceAll("?page=2", "?page=900"),
    raw.replace(/<tr class="rowPadding">[\s\S]*?<\/tr>/, ""),
    raw.replace(
      "/VehicleDealerShowParts/69/1119522",
      "/VehicleDealerShowParts/4573/1119522",
    ),
    raw.slice(0, -100),
    raw.replace("Showing 17884", "Showing 25001"),
  ])
    expect(() => parseHollanderstoresRoster(changed, aaa)).toThrow();
});
