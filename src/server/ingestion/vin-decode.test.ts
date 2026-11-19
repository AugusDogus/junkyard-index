import { expect, test } from "bun:test";
import { VinDecode } from "./vin-decode";

const request = {
  key: "1FTPW1456K:2006",
  vin: "1FTPW14506KD19655",
  year: 2006,
};
const ford = {
  VIN: request.vin,
  ErrorCode: "0",
  Make: "FORD",
  Model: "F-150",
  ModelYear: "2006",
  Trim: "XLT",
};

test("patterns ignore check digit and serial, retain plant, year and low-volume manufacturer", () => {
  expect(VinDecode.identity(request.vin, 2006)?.key).toBe(request.key);
  expect(VinDecode.identity("1FTPW14596K123456", 2006)?.key).toBe(request.key);
  expect(VinDecode.identity("1FTPW14596L123456", 2006)?.key).not.toBe(
    request.key,
  );
  expect(VinDecode.identity(request.vin, 2036)?.key).not.toBe(request.key);
  expect(VinDecode.identity("1F9PW14596K123456", 2006)?.key).not.toBe(
    VinDecode.identity("1F9PW14596K456789", 2006)?.key,
  );
  for (const [vin, year] of [
    ["ABC123", 1975],
    [request.vin, 2007],
    ["1FTPW14I96K123456", 2006],
    [request.vin, 1980],
  ] as const) {
    expect(VinDecode.identity(vin, year)).toBeNull();
  }
});

test("only clean identities and check digit warnings with a matching model year are trusted", () => {
  for (const ErrorCode of ["0", "1", "0,1"]) {
    expect(
      VinDecode.parseResponse({ Results: [{ ...ford, ErrorCode }] }, [
        request,
      ]).get(request.key),
    ).toEqual({ make: "Ford", model: "F-150", year: 2006, trim: "XLT" });
  }
  for (const change of [
    { ErrorCode: "5" },
    { ErrorCode: "1,14" },
    { ErrorCode: "" },
    { ModelYear: "2005" },
    { Model: "" },
    { Make: "" },
    { VIN: "OTHER" },
  ]) {
    expect(
      VinDecode.parseResponse({ Results: [{ ...ford, ...change }] }, [request])
        .size,
    ).toBe(0);
  }
  expect(
    VinDecode.parseResponse({ Results: [ford, ford] }, [request]).size,
  ).toBe(0);
  expect(VinDecode.parseResponse({}, [request]).size).toBe(0);
});

test("recorded public vPIC responses follow the site's make and model display conventions", async () => {
  const { default: fixture } =
    await import("./vpic-test-fixtures/identities.json");
  const requests = fixture.Results.flatMap((row) => {
    const id = VinDecode.identity(row.VIN, Number(row.ModelYear));
    return id ? [id] : [];
  });
  const result = VinDecode.parseResponse(fixture, requests);
  expect([...result.values()].map((row) => [row.make, row.model])).toEqual([
    ["Ford", "Fusion"],
    ["Chevrolet", "Impala"],
    ["Toyota", "Corolla"],
    ["Honda", "Civic"],
  ]);
});

test("an incomplete result does not discard clean identities in the same batch", () => {
  const response = { Results: [ford, { VIN: "unrelated", ErrorCode: "6" }] };
  expect(
    VinDecode.parseResponse(response, [request]).get(request.key)?.model,
  ).toBe("F-150");
});
