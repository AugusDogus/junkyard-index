import { expect, test } from "bun:test";
import { YardAddress } from "./yard-address";

test.each([
  "5795 Stockdale Rd, Paso Robles, CA 93446, USA",
  "5795 Stockdale Rd, Paso Robles, CA 93446, USA, Paso Robles, CA",
  "5795 Stockdale Rd",
])("formats %s with its city and state once", (address) => {
  expect(
    YardAddress.format({
      address,
      city: "Paso Robles",
      state: "CA",
      postalCode: "93446",
    }),
  ).toBe("5795 Stockdale Rd, Paso Robles, CA, 93446");
});

test("preserves unmatched locality information and street names containing the city", () => {
  expect(
    YardAddress.street({
      address: "100 Paso Robles Rd, Unit 2",
      city: "Paso Robles",
      state: "CA",
    }),
  ).toBe("100 Paso Robles Rd, Unit 2");
  expect(
    YardAddress.street({
      address: "100 Main St, Other City, CA",
      city: "Paso Robles",
      state: "CA",
    }),
  ).toBe("100 Main St, Other City, CA");
  expect(
    YardAddress.format({ address: null, city: "Paso Robles", state: "CA" }),
  ).toBe("Paso Robles, CA");
});

test("preserves the explicit postal code when it exists only in the full address", () => {
  expect(
    YardAddress.normalize({
      address: "5795 Stockdale Rd, Paso Robles, CA 93446, USA",
      city: "Paso Robles",
      state: "CA",
    }),
  ).toEqual({ address: "5795 Stockdale Rd", postalCode: "93446" });
});
