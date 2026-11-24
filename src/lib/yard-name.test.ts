import { expect, test } from "bun:test";
import { YardName } from "./yard-name";

test.each([
  ["KIKER'S U PULL IT", "Kiker's U Pull It"],
  ["PICK-n-PULL OAKLAND", "PICK-n-PULL Oakland"],
  ["LKQ PICK YOUR PART - HUNTSVILLE", "LKQ Pick Your Part - Huntsville"],
  ["U-Pull-&-Pay - DENVER", "U-Pull-&-Pay - Denver"],
  ["AutoZone Salvage LLC", "AutoZone Salvage LLC"],
])(
  "normalizes yard casing while preserving known brands: %s",
  (raw, expected) => {
    expect(YardName.display(raw)).toBe(expected);
  },
);

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

test.each([
  ["Cfc Recycling", "CFC Recycling"],
  ["Pick Your Part - Houston Sw", "Pick Your Part - Houston SW"],
  ["Pick Your Part - East Nc", "Pick Your Part - East NC"],
  ["Rtp Pick-A-Part - Lexington, Ky", "RTP Pick-A-Part - Lexington, KY"],
  ["Raceway Pik-A-Part - Savannah, Tn", "Raceway Pik-A-Part - Savannah, TN"],
  ["S&w U-Pull, U-Save", "S&W U-Pull, U-Save"],
  ["K&r Truck Parts", "K&R Truck Parts"],
  ["Jdm Automotive & Recycling", "JDM Automotive & Recycling"],
  // Words that only look like abbreviations keep their casing.
  ["Foss La Grange", "Foss La Grange"],
  ["Carz R Us 1", "Carz R Us 1"],
  ["Pick Ur Part", "Pick Ur Part"],
])("capitalizes initials in yard names: %s", (raw, expected) => {
  expect(YardName.display(raw)).toBe(expected);
});

test("resolve takes initials from the operator's spelling", () => {
  const resolve = (name: string, operator: string) =>
    YardName.resolve({ source: "hollanderstores", name, city: "X", operator });
  expect(resolve("Nwa U-Pull-It", "NWA U-Pull-It")).toBe("NWA U-Pull-It");
  expect(resolve("B&k Auto Salvage", "B&K Auto Salvage")).toBe(
    "B&K Auto Salvage",
  );
  expect(resolve("Mst Recycling", "MST Recycling")).toBe("MST Recycling");
  expect(
    resolve(
      "Us Auto Supply Of Sterling Heights",
      "US Auto Supply of Sterling Heights",
    ),
  ).toBe("US Auto Supply Of Sterling Heights");
  expect(resolve("Tri Town Auto Salvage", "Tri Town Auto Salvage")).toBe(
    "Tri Town Auto Salvage",
  );
});

test("an all-caps operator does not capitalize whole yard names", () => {
  expect(
    YardName.resolve({
      source: "autorecycler",
      name: "Ario Auto Parts",
      city: "Austin",
      operator: "ARIO AUTO PARTS",
    }),
  ).toBe("Ario Auto Parts");
});
