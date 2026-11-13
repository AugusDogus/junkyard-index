import { expect, test } from "bun:test";
import { transformCentralRecord } from "./central-transform";
import { centralFixtureRecord } from "./central-test-fixtures";
const context = { make: "ACURA", model: "ILX", makePath: "/used-parts/ACURA" };
test("Central requires native VIN, year, make/model and owned year-bound destination", () => {
  const good = centralFixtureRecord(1);
  for (const field of [0, 1, 2, 4] as const) {
    const row = centralFixtureRecord(1);
    row[field] = "";
    expect(transformCentralRecord(row, context).status).toBe("incomplete");
  }
  const wrong = centralFixtureRecord(1);
  wrong[4] = "/used-parts/ACURA/ILX/ST1/2004";
  expect(transformCentralRecord(wrong, context).status).toBe("incomplete");
  expect(transformCentralRecord(good, context).status).toBe("available");
  const bare = centralFixtureRecord(1);
  bare[2] = "ILX";
  expect(transformCentralRecord(bare, context).status).toBe("incomplete");
});
test("Central only accepts a make-as-model with its literal native model control", () => {
  const row = centralFixtureRecord(1);
  row[2] = "LAND ROVER";
  row[4] = "/used-parts/LAND_ROVER/LAND_ROVER/ST1/2003";
  const available = transformCentralRecord(row, {
    make: "LAND ROVER",
    model: "LAND ROVER",
    makePath: "/used-parts/LAND_ROVER",
  });
  expect(available.status).toBe("available");
  if (available.status === "available")
    expect(available.vehicle.model).toBe("LAND ROVER");
  expect(
    transformCentralRecord(row, {
      make: "LAND ROVER",
      model: "DISCOVERY",
      makePath: "/used-parts/LAND_ROVER",
    }).status,
  ).toBe("incomplete");
});
test("Central preserves native punctuation and nullable optional metadata without changing required eligibility", () => {
  const row = centralFixtureRecord(1);
  row[3] = "J&V";
  row[4] = "/used-parts/ACURA/ILX/J&V/2003";
  const result = transformCentralRecord(row, context);
  expect(result.status).toBe("available");
  if (result.status === "available")
    expect(result.vehicle.stockNumber).toBe("J&V");
  row[3] = "-";
  row[5] = "https://example.com/pixel.jpg";
  const optional = transformCentralRecord(row, context);
  expect(optional.status).toBe("available");
  if (optional.status === "available")
    expect(optional.vehicle).toMatchObject({
      stockNumber: null,
      imageUrl: null,
      availableDate: null,
      color: null,
      row: null,
      section: null,
      space: null,
    });
});
