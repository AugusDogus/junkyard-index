import { expect, test } from "bun:test";
import { IdipullCatalog } from "./idipull-catalog";
import {
  idipullTestPage,
  idipullTestRecord,
  idipullTestRow,
} from "./idipull-test-fixtures";

const asOf = new Date("2026-11-16T12:00:00Z");

test("Idaho Falls requires one real calendar update date and ignores script/comment stamps", () => {
  expect(IdipullCatalog.parse(idipullTestPage()).updated).toBe("2026-11-11");
  for (const updated of ["", "02/30/26", "11/11/26 Updated: 11/11/26"])
    expect(() =>
      IdipullCatalog.parse(idipullTestPage().replace("11/11/26", updated)),
    ).toThrow("update label");
  expect(
    IdipullCatalog.parse(
      idipullTestPage().replace(
        "</body>",
        "<!-- Updated: 01/01/25 --><script>Updated: 01/01/25</script></body>",
      ),
    ).updated,
  ).toBe("2026-11-11");
});

test("Idaho Falls closing membership ignores row order but preserves every row and field", () => {
  const second = {
    ...idipullTestRecord,
    stockNumber: "STK999999",
    color: "BLUE",
  };
  const first = IdipullCatalog.parse(
    idipullTestPage(idipullTestRow() + idipullTestRow(second)),
  );
  const reversed = IdipullCatalog.parse(
    idipullTestPage(idipullTestRow(second) + idipullTestRow()),
  );
  expect(IdipullCatalog.signature(first)).toBe(
    IdipullCatalog.signature(reversed),
  );
  expect(IdipullCatalog.signature(first)).not.toBe(
    IdipullCatalog.signature({
      ...first,
      records: [...first.records, idipullTestRecord],
    }),
  );
});

test("Idaho Falls arrival currency uses an inclusive 60-day window and ignores future dates", () => {
  const catalog = IdipullCatalog.parse(idipullTestPage());
  expect(() =>
    IdipullCatalog.validateCurrency(catalog, ["2026-09-17"], asOf),
  ).not.toThrow();
  expect(() =>
    IdipullCatalog.validateCurrency(
      catalog,
      ["2026-09-16", "2026-11-17", null],
      asOf,
    ),
  ).toThrow("no admitted arrival");
  expect(() =>
    IdipullCatalog.validateCurrency(
      { ...catalog, updated: "2026-11-17" },
      ["2026-11-10"],
      asOf,
    ),
  ).toThrow("future-dated");
  expect(() =>
    IdipullCatalog.validateCurrency(catalog, ["2026-11-12"], asOf),
  ).toThrow("no admitted arrival");
  expect(() =>
    IdipullCatalog.validateCurrency(catalog, ["2026-11-10"], new Date(NaN)),
  ).toThrow("valid observation date");
});

test.each(["", "2/01/26", "02/29/26", "13/01/26"])(
  "Idaho Falls leaves unusable arrival dates null (%s)",
  (raw) => {
    expect(IdipullCatalog.date(raw)).toBeNull();
  },
);
