import { expect, test } from "bun:test";
import { YardName } from "./yard-name";

test("headline names the operator when it extends the listed brand", () => {
  expect(
    YardName.headline("Pick Your Part - Sun Valley", "LKQ Pick Your Part"),
  ).toBe("LKQ Pick Your Part - Sun Valley");
});

test("headline keeps names that already carry their brand", () => {
  expect(YardName.headline("Pull-A-Part - Conley", "Pull-A-Part")).toBe(
    "Pull-A-Part - Conley",
  );
  expect(YardName.headline("PICK-n-PULL Oakland", null)).toBe(
    "PICK-n-PULL Oakland",
  );
  expect(YardName.headline("Foss Wilson", "Foss")).toBe("Foss Wilson");
  expect(YardName.headline("Pull N Save - Tucson", "Pull-N-Save")).toBe(
    "Pull N Save - Tucson",
  );
});

test("resolves legacy city names using the known operator", () => {
  expect(
    YardName.resolve({
      source: "pullapart",
      name: "Birmingham",
      city: "Birmingham",
      operator: "Pull-A-Part",
    }),
  ).toBe("Pull-A-Part - Birmingham");
  expect(
    YardName.resolve({
      source: "pullapart",
      name: "Denver",
      city: "Denver",
      operator: "U-Pull-&-Pay",
    }),
  ).toBe("U-Pull-&-Pay - Denver");
  expect(
    YardName.resolve({
      source: "pullapart",
      name: "Denver",
      city: "Denver",
      inventoryUrl: "https://www.upullandpay.com/inventory/search/",
    }),
  ).toBe("U-Pull-&-Pay - Denver");
  expect(
    YardName.resolve({ source: "pullapart", name: "New Yard", city: "City" }),
  ).toBe("Pull-A-Part / U-Pull-&-Pay - New Yard");
  expect(
    YardName.resolve({
      source: "pullapart",
      name: "Pull-A-Part - Birmingham",
      city: "Birmingham",
      operator: "Pull-A-Part",
    }),
  ).toBe("Pull-A-Part - Birmingham");
  expect(
    YardName.resolve({ source: "pyp", name: "Sun Valley", city: "Sun Valley" }),
  ).toBe("LKQ Pick Your Part - Sun Valley");
  expect(
    YardName.resolve({
      source: "row52",
      name: "City",
      city: "City",
      operator: "Independent Auto",
    }),
  ).toBe("Independent Auto - City");
});
