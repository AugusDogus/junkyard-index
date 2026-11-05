import { describe, expect, test } from "bun:test";
import { VehicleName } from "./vehicle-name";

describe("VehicleName.makeKey", () => {
  test("merges aliases and spellings", () => {
    expect(VehicleName.makeKey("Vw")).toBe("VOLKSWAGEN");
    expect(VehicleName.makeKey("Volkswagen")).toBe("VOLKSWAGEN");
    expect(VehicleName.makeKey("Mercedes")).toBe("MERCEDESBENZ");
    expect(VehicleName.makeKey("Mercedes-Benz")).toBe("MERCEDESBENZ");
    expect(VehicleName.makeKey("Land Rover")).toBe("LANDROVER");
  });

  test("rejects placeholders", () => {
    expect(VehicleName.makeKey("Other")).toBeNull();
    expect(VehicleName.makeKey(" ")).toBeNull();
    expect(VehicleName.makeKey("Yellow")).toBeNull();
  });
});

describe("VehicleName.modelKey", () => {
  test("ignores case and punctuation", () => {
    expect(VehicleName.modelKey("BMW", "3-Series")).toBe("3SERIES");
    expect(VehicleName.modelKey("BMW", "3 SERIES")).toBe("3SERIES");
    expect(VehicleName.modelKey("Ford", "F-150")).toBe("F150");
  });

  test("reads & as and, like the model's URL does", () => {
    expect(VehicleName.modelKey("Chrysler", "Town & Country")).toBe(
      VehicleName.modelKey("Chrysler", "TOWN AND COUNTRY"),
    );
  });

  test("drops a repeated make", () => {
    expect(VehicleName.modelKey("BMW", "BMW 328i")).toBe("328I");
    expect(VehicleName.modelKey("Lexus", "LEXUS ES330")).toBe("ES330");
    expect(VehicleName.modelKey("Vw", "Volkswagen Jetta")).toBe("JETTA");
  });

  test("gives bare numbers the make, so every spelling of one model matches", () => {
    const mazda3 = ["3", "Mazda3", "MAZDA3", "MAZDA 3"].map((model) =>
      VehicleName.modelKey("Mazda", model),
    );
    expect(new Set(mazda3)).toEqual(new Set(["MAZDA3"]));
    expect(VehicleName.modelKey("Saab", "9-3")).toBe(
      VehicleName.modelKey("Saab", "SAAB 9-3"),
    );
  });

  test("returns null for an empty model or one that only repeats the make", () => {
    expect(VehicleName.modelKey("Ford", " - ")).toBeNull();
    expect(VehicleName.modelKey("Dodge", "Dodge")).toBeNull();
    expect(VehicleName.modelKey("Chevrolet", "CHEVY")).toBeNull();
  });
});

describe("VehicleName.modelName", () => {
  test("strips a repeated make from the spelling shown", () => {
    expect(VehicleName.modelName("Ford", "FORD F150 PICKUP")).toBe(
      "F150 PICKUP",
    );
    expect(VehicleName.modelName("Mazda", "MAZDA 3")).toBe("MAZDA 3");
  });
});

describe("VehicleName.title", () => {
  test("names the make once", () => {
    expect(VehicleName.title("Ford", "F-150")).toBe("Ford F-150");
    expect(VehicleName.title("Fiat", "500")).toBe("Fiat 500");
    expect(VehicleName.title("Mazda", "Mazda3")).toBe("Mazda3");
    expect(VehicleName.title("Mazda", "3")).toBe("Mazda 3");
  });
});

describe("VehicleName.preferredSpelling", () => {
  test("prefers a common mixed-case spelling", () => {
    expect(
      VehicleName.preferredSpelling(
        new Map([
          ["ACCORD", 4421],
          ["Accord", 2261],
        ]),
      ),
    ).toBe("Accord");
    expect(
      VehicleName.preferredSpelling(new Map([["F-250 SUPER DUTY", 275]])),
    ).toBe("F-250 SUPER DUTY");
  });

  test("ignores a rare mixed-case spelling", () => {
    expect(
      VehicleName.preferredSpelling(
        new Map([
          ["RX 300", 154],
          ["RX300", 136],
          ["Rx 300", 1],
        ]),
      ),
    ).toBe("RX 300");
  });
});

test("sameSlug ignores hyphens and case", () => {
  expect(VehicleName.sameSlug("mazda3", "mazda-3")).toBe(true);
  expect(VehicleName.sameSlug("civic", "CIVIC")).toBe(true);
  expect(VehicleName.sameSlug("civic", "accord")).toBe(false);
});
