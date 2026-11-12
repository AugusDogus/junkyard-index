import { expect, test } from "bun:test";
import {
  parseUwrenchInventory,
  parseUwrenchOwner,
  uwrenchNativeDate,
} from "./uwrench-parser";
import { transformUwrenchRow } from "./uwrench-transform";
import {
  uwrenchTestInventory,
  uwrenchTestOwner,
  uwrenchTestRecord,
  uwrenchTestRow,
} from "./uwrench-test-fixtures";

test("native enumeration supplies whole YMM and real optional fields with API identity only", () => {
  parseUwrenchOwner(uwrenchTestOwner);
  const table = parseUwrenchInventory(uwrenchTestInventory());
  expect(table.rows).toHaveLength(1);
  const row = table.rows[0];
  if (!row) throw new Error("Expected native fixture row");
  expect(transformUwrenchRow(row, uwrenchTestRecord)).toMatchObject({
    status: "available",
    vehicle: {
      vin: "1J4FA49S94P785631",
      year: 2004,
      make: "Jeep",
      model: "WRANGLER",
      engine: "100306. 4.0",
      stockNumber: "STK000802",
      row: "1",
      availableDate: "2018-06-26",
      color: "Red",
      imageUrl: null,
    },
  });
  expect(transformUwrenchRow(row, undefined)).toEqual({
    status: "rejected",
    stock: "STK000802",
    reason: "identity-unavailable",
    vin: null,
  });
});

test("commented catalog bridge and impossible native leap labels are not evidence", () => {
  expect(() =>
    parseUwrenchOwner(
      uwrenchTestOwner
        .replace("<script>", "<!--<script>")
        .replace("</script>", "</script>-->"),
    ),
  ).toThrow("catalog bridge");
  expect(uwrenchNativeDate("02/29/01")).toBeNull();
  expect(uwrenchNativeDate("02/29/00")).toBe("02/29/00");
  expect(() =>
    parseUwrenchOwner(uwrenchTestOwner.replace("iframe.src", "// iframe.src")),
  ).toThrow("catalog bridge");
});

test("missing or unusable optional native/API dates preserve the donor", () => {
  const table = parseUwrenchInventory(uwrenchTestInventory());
  const row = table.rows[0];
  if (!row) throw new Error("Expected fixture row");
  expect(
    transformUwrenchRow(
      { ...row, sourceSetDate: "02/29/01" },
      uwrenchTestRecord,
    ),
  ).toMatchObject({
    status: "available",
    vehicle: { availableDate: "2018-06-26" },
  });
  expect(
    transformUwrenchRow(
      { ...row, sourceSetDate: "" },
      { ...uwrenchTestRecord, dateAdded: "unknown" },
    ),
  ).toMatchObject({ status: "available", vehicle: { availableDate: null } });
  expect(
    transformUwrenchRow(row, {
      ...uwrenchTestRecord,
      dateAdded: "2018-06-26T14:59:35.830Z",
    }),
  ).toMatchObject({ status: "available", vehicle: { availableDate: null } });
});

test("unusable required native YMM is retained without an invented selector", () => {
  const table = parseUwrenchInventory(
    uwrenchTestInventory([
      uwrenchTestRow,
      { ...uwrenchTestRow, stock: "STK000803", model: "" },
    ]),
  );
  expect(table.rows).toHaveLength(2);
  expect(table.pairs).toEqual([{ make: "JEEP", model: "WRANGLER" }]);
  const row = table.rows[1];
  if (!row) throw new Error("Missing invalid native row");
  expect(
    transformUwrenchRow(row, { ...uwrenchTestRecord, stock: row.stock }),
  ).toEqual({
    status: "rejected",
    stock: row.stock,
    vin: "1J4FA49S94P785631",
    reason: "invalid-native-ymm",
  });
});

test("native server continuation fails while unrelated blog navigation is harmless", () => {
  const next =
    '<nav aria-label="Inventory pagination"><a rel="next" href="https://uwrenchandsave.com/inventory/page/2/">Next inventory page</a></nav>';
  expect(() =>
    parseUwrenchInventory(
      uwrenchTestInventory().replace("</table>", "</table>" + next),
    ),
  ).toThrow("server-side donor continuation");
  expect(
    parseUwrenchInventory(
      uwrenchTestInventory().replace(
        "</table>",
        '</table><a rel="next" href="https://uwrenchandsave.com/blog/page/2/">Next blog page</a>',
      ),
    ).rows,
  ).toHaveLength(1);
  expect(() =>
    parseUwrenchInventory(
      uwrenchTestInventory().replace(
        "</table>",
        '</table><a rel="next" href="/inventory/?page=2">2</a>',
      ),
    ),
  ).toThrow("server-side donor continuation");
  expect(() =>
    parseUwrenchInventory(
      uwrenchTestInventory().replace(
        "</table>",
        '</table><a href="/inventory/?page=2">2</a>',
      ),
    ),
  ).toThrow("server-side donor continuation");
  expect(() =>
    parseUwrenchInventory(
      uwrenchTestInventory().replace(
        "</table>",
        '</table><script>$("#vehicles").DataTable({serverSide:true,ajax:"/inventory/page/2/"});</script>',
      ),
    ),
  ).toThrow("remote DataTables");
});
