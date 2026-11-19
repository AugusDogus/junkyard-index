import { describe, expect, test } from "bun:test";
import { parseHawaiipartsInventory } from "./hawaiiparts-parser";
import {
  HAWAIIPARTS_CATALOG,
  HAWAIIPARTS_YARD,
} from "./hawaiiparts-yard-metadata";
import { shopifyYardFixture } from "./shopify-yard-test-fixtures";
import { shopifyYardSnapshot } from "./shopify-yard-snapshot";

// 2026-11-19 capture: cards are positional `car-N` anchors, and the VIN moved
// from visible text into base64 `data-v`, revealed only by the page script.
const yard = () => shopifyYardFixture("hawaiiparts-yard-html");
const census = (raw = yard()) =>
  shopifyYardSnapshot(
    parseHawaiipartsInventory(raw),
    HAWAIIPARTS_YARD,
    "Hawaii",
    14,
    null,
  );

describe("Hawaii Parts encoded VIN roster", () => {
  test("native page script decodes data-v and resolves ?car=<vin> deep links", () => {
    const raw = yard();
    expect(raw).toContain("v=atob(c.dataset.v||'')");
    expect(raw).toContain("// car detail view: ?car=<vin>");
    expect(raw).toContain("x._vin.toLowerCase()===key");
    expect(raw).not.toContain('class="hp-ycar__vin">VIN ');
  });
  test("publishes all 44 counted cards with VINs decoded from data-v", () => {
    const result = census();
    expect(result.accounting).toEqual({
      recordsProcessed: 44,
      recordsExcluded: 0,
      recordsRejected: 0,
      duplicateVehicles: 0,
    });
    expect(result.vehicles).toHaveLength(44);
    const camry = result.vehicles.find((v) => v.vin === "4T1BF1FK8FU473924");
    expect(camry).toMatchObject({
      year: 2015,
      make: "Toyota",
      model: "Camry",
      detailsUrl: HAWAIIPARTS_CATALOG + "?car=4t1bf1fk8fu473924",
    });
    expect(
      result.vehicles.every(
        (v) =>
          v.detailsUrl === HAWAIIPARTS_CATALOG + "?car=" + v.vin.toLowerCase(),
      ),
    ).toBe(true);
  });
  test("rejects cards whose encoded VIN is missing, malformed or not a clean base64 claim", () => {
    const car1 = 'data-v="NFQxQkYxRks4RlU0NzM5MjQ="';
    for (const changed of [
      yard().replace(car1, ""),
      yard().replace(car1, 'data-v="!!not base64!!"'),
      yard().replace(car1, 'data-v="NFQxQkYxRks4RlU0NzM5MjQ"'),
      yard().replace(car1, 'data-v="PGI+NFQxQkYxRks4RlU0NzM5MjQ8L2I+"'),
    ]) {
      const rows = parseHawaiipartsInventory(changed);
      expect(rows.find((r) => r.id === "car-1")?.reasons).toContain(
        "conflicting-native-identity",
      );
      expect(census(changed).accounting.recordsRejected).toBe(1);
    }
  });
  test("rejects a card that no longer offers the public VIN reveal control", () => {
    const rows = parseHawaiipartsInventory(
      yard().replace(
        '<button type="button" class="hp-ycar__vin hp-vinbtn">VIN · Show VIN</button>',
        "",
      ),
    );
    expect(rows.filter((r) => r.reasons.length)).toHaveLength(1);
  });
  test("two cards claiming one VIN are not both published", () => {
    const result = census(
      yard().replace(
        'data-v="S01ITDM0SkoyU0ExMjE2NDI="',
        'data-v="NFQxQkYxRks4RlU0NzM5MjQ="',
      ),
    );
    expect(result.vehicles.map((v) => v.vin)).not.toContain(
      "KMHL34JJ2SA121642",
    );
    expect(
      result.vehicles.filter((v) => v.vin === "4T1BF1FK8FU473924").length,
    ).toBeLessThanOrEqual(1);
    expect(
      result.accounting.recordsRejected + result.accounting.duplicateVehicles,
    ).toBeGreaterThanOrEqual(1);
  });
  test("fails closed when positional anchors repeat", () => {
    expect(() =>
      parseHawaiipartsInventory(yard().replace('id="car-2"', 'id="car-1"')),
    ).toThrow();
  });
});
