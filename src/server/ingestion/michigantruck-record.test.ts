import { expect, test } from "bun:test";
import { transformMichigantruckRecord } from "./michigantruck-record";
import { michigantruckTestRecord } from "./michigantruck-test-fixtures";

test("Michigan Truck requires native VIN/YMM, preserves historic serial and rejected identity presence", () => {
  const historical = transformMichigantruckRecord(
    michigantruckTestRecord(1, {
      year: "1979",
      vin: "W80DVEC8987",
      make: "Ford",
    }),
  );
  expect(historical.status === "available" && historical.vehicle.vin).toBe(
    "W80DVEC8987",
  );
  expect(
    transformMichigantruckRecord(
      michigantruckTestRecord(1, { model: "Other" }),
    ),
  ).toEqual({ status: "incomplete", vin: "1FVACXDT6B0000001" });
  expect(
    transformMichigantruckRecord(michigantruckTestRecord(1, { vin: "BADVIN" })),
  ).toEqual({ status: "incomplete", vin: null });
});
test("Michigan Truck retail exclusions precede required donor validation", () => {
  expect(
    transformMichigantruckRecord(
      michigantruckTestRecord(1, {
        condition: "Complete",
        vin: "",
        make: "",
        model: "",
      }),
    ),
  ).toEqual({ status: "excluded" });
});
test("Michigan Truck nulls invalid optional data and rejects placeholder required descriptions", () => {
  for (const value of [
    "Other",
    "N/A",
    "NULL",
    "None",
    "undefined",
    "-",
    "000",
  ]) {
    for (const field of ["make", "model"])
      expect(
        transformMichigantruckRecord(
          michigantruckTestRecord(1, { [field]: value }),
        ).status,
      ).toBe("incomplete");
    const result = transformMichigantruckRecord(
      michigantruckTestRecord(1, { engine: value, stockNumber: value }),
    );
    expect(result.status === "available" && result.vehicle.engine).toBeNull();
    expect(
      result.status === "available" && result.vehicle.stockNumber,
    ).toBeNull();
  }
  const result = transformMichigantruckRecord(
    michigantruckTestRecord(1, {
      imageUrl: "https://other.example/trucks/6/photo.jpg",
    }),
  );
  expect(result.status === "available" && result.vehicle.imageUrl).toBeNull();
});

test("Michigan Truck preserves a native photo filename containing parentheses", () => {
  const imageUrl =
    "https://images.truckpartsinventory.com/trucks/6/1981-Crane-Carrier-Co.-Drill-Rig-(DR-IR)-oL7HIXDJ4JFZ_f.webp";
  const result = transformMichigantruckRecord(
    michigantruckTestRecord(1, { imageUrl }),
  );
  expect(result.status === "available" && result.vehicle.imageUrl).toBe(
    imageUrl,
  );
});
