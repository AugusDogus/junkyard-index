import { describe, expect, test } from "bun:test";
import {
  parseOemgarageCatalog,
  parseOemgarageDetail,
  parseOemgarageOwner,
} from "./oemgarage-parser";
import { assessOemgarageRecord } from "./oemgarage-transform";
import { oemgarageFixture } from "./oemgarage-test-fixtures";

const catalogHtml = () => oemgarageFixture("oemgarage-donors").body;
const card = (id: string) => {
  const value = parseOemgarageCatalog(catalogHtml()).cards.find(
    (c) => c.id === id,
  );
  if (!value) throw new Error("Missing native oeM Garage donor " + id);
  return value;
};
describe("oeM Garage actual native donor graph", () => {
  test("physical owner and complete finite 258-donor grid", () => {
    expect(
      parseOemgarageOwner(oemgarageFixture("dov-oemgarage").body),
    ).toHaveLength(64);
    const catalog = parseOemgarageCatalog(catalogHtml());
    expect(catalog.cards).toHaveLength(258);
    expect(new Set(catalog.cards.map((c) => c.id)).size).toBe(258);
    expect(catalog.cards[0]?.id).toBe("636");
  });
  test("one remaining native part does not lose its donor identity", () => {
    const record = parseOemgarageDetail(
      oemgarageFixture("oemgarage-donor-223").body,
      card("223"),
    );
    expect(record.partsCount).toBe(1);
    const result = assessOemgarageRecord(record);
    expect(result.status).toBe("available");
    if (result.status !== "available")
      throw new Error("Actual labeled native donor was rejected");
    expect(result.vehicle.vin).toBe("WBAWB73557P034969");
    expect(result.vehicle.year).toBe(2007);
    expect(result.vehicle.make).toBe("BMW");
    expect(result.vehicle.model).toBe("335i");
  });
  test("labeled native metadata and donor-bound photo are retained", () => {
    const record = parseOemgarageDetail(
      oemgarageFixture("oemgarage-donor-100").body,
      card("100"),
    );
    const result = assessOemgarageRecord(record);
    expect(result.status).toBe("available");
    if (result.status !== "available")
      throw new Error("Actual labeled native donor was rejected");
    expect(result.vehicle.vin).toBe("WBA7E2C59GG504712");
    expect(result.vehicle.model).toBe("740Li");
    expect(result.vehicle.availableDate).toBe("2026-09-25");
    expect(result.vehicle.color).toBe("Black");
    expect(result.vehicle.imageUrl).toContain("/donor-100-car1.jpg?");
    expect(result.vehicle.row).toBeNull();
  });
  test("truncated documents and incomplete finite-filter controls fail closed", () => {
    expect(() =>
      parseOemgarageCatalog(catalogHtml().replace(/<\/html>\s*$/, "")),
    ).toThrow("incomplete");
    expect(() =>
      parseOemgarageCatalog(
        catalogHtml().replace(
          "search.addEventListener('input', apply)",
          "missingListener()",
        ),
      ),
    ).toThrow("finite donor grid");
  });
});
