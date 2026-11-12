import { expect, test } from "bun:test";
import {
  classifyPipesInventory,
  transformPipesRecord,
} from "./pipes-transform";
import { pipesTestNative, pipesTestRecord } from "./pipes-test-fixtures";

test("Pipes preserves genuine modern rejected identity when native year is unusable", () => {
  const native = { ...pipesTestNative, rawYear: "20xx", year: null };
  expect(transformPipesRecord(native, pipesTestRecord)).toEqual({
    status: "incomplete",
    reason: "native_required_fields",
    vin: "1FAHP3FN0AW123456",
  });
  expect(
    transformPipesRecord(native, {
      ...pipesTestRecord,
      year: 1978,
      vin: "8F03Z175297",
    }),
  ).toEqual({
    status: "incomplete",
    reason: "native_required_fields",
    vin: null,
  });
});
test("Pipes quarantines API-only stocks once while retaining genuine identity presence", () => {
  const extra = {
    ...pipesTestRecord,
    stock: "STK041001",
    vin: "1FAHP3FN0AW654321",
  };
  const result = classifyPipesInventory(
    [pipesTestNative],
    new Map([
      [pipesTestRecord.stock, pipesTestRecord],
      [extra.stock, extra],
    ]),
  );
  expect(result).toMatchObject({
    processed: 2,
    rejected: 1,
    quarantined: 1,
    observedVins: ["1FAHP3FN0AW654321"],
  });
  expect(result.vehicles).toHaveLength(1);
  expect(result.vehicles[0]?.stockNumber).toBe(pipesTestNative.stock);
});
test("Pipes uses only API dateAdded and native engine-like references", () => {
  for (const reference of ["SHELL", "817-823-8711", null]) {
    const result = transformPipesRecord(
      { ...pipesTestNative, reference, arrivalDate: "01/01/2020" },
      {
        ...pipesTestRecord,
        dateAdded: "bad date",
        recencyAnchor: "2026-11-11T17:00:00-06:00",
      },
    );
    expect(result).toMatchObject({
      status: "available",
      vehicle: { engine: null, availableDate: null },
    });
  }
  for (const reference of ["L4, 2.3L; SOHC", "B4, 2.0L"])
    expect(
      transformPipesRecord({ ...pipesTestNative, reference }, pipesTestRecord),
    ).toMatchObject({ status: "available", vehicle: { engine: reference } });
});
