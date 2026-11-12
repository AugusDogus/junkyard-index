import { expect, test } from "bun:test";
import {
  parseJolietAnalytics,
  parseJolietConfig,
  parseJolietContact,
  parseJolietInventory,
  parseJolietOwner,
  parseJolietSearch,
} from "./joliet-parser";
import {
  jolietTestAnalytics,
  jolietTestConfig,
  jolietTestContact,
  jolietTestInventory,
  jolietTestOwner,
  jolietTestSearch,
} from "./joliet-test-fixtures";

test("Joliet uses visible ownership, native embed and the entire table despite copied Littleton metadata", () => {
  parseJolietOwner(jolietTestOwner);
  parseJolietContact(jolietTestContact);
  parseJolietConfig(jolietTestConfig);
  const table = parseJolietInventory(jolietTestInventory());
  expect(table.rows).toHaveLength(1);
  expect(table.pairs).toEqual([{ make: "FORD", model: "TAURUS" }]);
  expect(parseJolietAnalytics(jolietTestAnalytics())).toEqual({
    count: 1,
    years: [{ year: 2014, count: 1 }],
  });
  expect(
    parseJolietSearch(jolietTestSearch(), { make: "FORD", model: "TAURUS" }),
  ).toHaveLength(1);
});

test.each([
  (raw: string) =>
    raw.replace("1014 E. Washington Street", "8571 US Hwy. 85 N"),
  (raw: string) => raw.replace("tel:8157233011", "tel:3037911380"),
  (raw: string) => raw.replace("parts/joliet", "parts/littleton"),
  (raw: string) => raw.replace("</html>", ""),
])("Joliet refuses missing or foreign visible ownership (%#)", (rewrite) => {
  expect(() => parseJolietOwner(rewrite(jolietTestOwner))).toThrow();
  expect(() => parseJolietInventory(rewrite(jolietTestInventory()))).toThrow();
  expect(() => parseJolietContact(rewrite(jolietTestContact))).toThrow();
});

test.each([
  (raw: string) => raw.replace("</td>", ""),
  (raw: string) => raw.replace("Stock#", "ID"),
  (raw: string) => raw.replace("STK075102", ""),
  (raw: string) => raw.replace("</tr></tbody>", "<td>EXTRA</td></tr></tbody>"),
  (raw: string) =>
    raw.replace(
      "</body>",
      '<table class="table-parts"><tbody><tr><td>MORE</td></tr></tbody></body>',
    ),
])("Joliet refuses partial or ambiguous native table scope (%#)", (rewrite) => {
  expect(() => parseJolietInventory(rewrite(jolietTestInventory()))).toThrow();
});

test("Joliet public config cannot switch owner, enable demo inventory or add locations", () => {
  for (const [from, to] of [
    ['"yard_id":"joliet_u_pull_it"', '"yard_id":"littleton_u_pull_it"'],
    ['"demo_freshness_enabled":false', '"demo_freshness_enabled":true'],
    ['"multi_location_enabled":false', '"multi_location_enabled":true'],
  ] as const)
    expect(() =>
      parseJolietConfig(jolietTestConfig.replace(from, to)),
    ).toThrow();
});
