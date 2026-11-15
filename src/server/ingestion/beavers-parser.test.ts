import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import { parseBeaversCatalog, parseBeaversDetail } from "./beavers-parser";
import { BEAVERS_CATALOG } from "./beavers-yard-metadata";
const fixture = (name: string) =>
  readFileSync(`${import.meta.dir}/beavers-test-fixtures/${name}.html`, "utf8");
describe("Beaver's native inventory", () => {
  test("reads actual count, literal forward pager, tenant and donor joins", () => {
    const page = parseBeaversCatalog(fixture("first"), BEAVERS_CATALOG);
    expect(page.total).toBe(290);
    expect(page.rows).toHaveLength(20);
    expect(page.next).toBe(`${BEAVERS_CATALOG}?page=2`);
    const row = page.rows[0];
    if (!row) throw new Error("Missing genuine donor fixture");
    const donor = parseBeaversDetail(fixture("donor"), row);
    expect(donor.make).toBe("ACURA");
    expect(donor.vin).toBe("5J8YD3H36JL001078");
    expect(donor.displayYear).toBe("'18");
  });
  test("preserves an actually absent native make for required-field rejection", () => {
    const page = parseBeaversCatalog(
      fixture("second"),
      `${BEAVERS_CATALOG}?page=2`,
    );
    const row = page.rows.find((row) => row.stock === "260512");
    if (!row) throw new Error("Missing genuine absent-make fixture");
    expect(parseBeaversDetail(fixture("missing-make"), row).make).toBeNull();
  });
  test("proves the terminal partial page and rejects skipped or ignored page requests", () => {
    const page = parseBeaversCatalog(
      fixture("last"),
      `${BEAVERS_CATALOG}?page=15`,
    );
    expect(page.rows).toHaveLength(10);
    expect(page.next).toBeNull();
    expect(() =>
      parseBeaversCatalog(fixture("first"), `${BEAVERS_CATALOG}?page=2`),
    ).toThrow();
  });
  test("rejects partial HTML, foreign tenants, missing rows and count/pager disagreement", () => {
    for (const raw of [
      fixture("first").replace(/<\/html>/i, ""),
      fixture("first").replaceAll("BeaversCarSalvage", "OtherYard"),
      fixture("first").replace("/503/72805148", "/999/72805148"),
      fixture("first").replace("Showing 290", "Showing 20"),
    ])
      expect(() => parseBeaversCatalog(raw, BEAVERS_CATALOG)).toThrow();
  });
});
