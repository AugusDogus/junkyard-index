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

  test("returns null for placeholders that name no model", () => {
    expect(VehicleName.modelKey("Honda", "MOTORCYCLE")).toBeNull();
    expect(VehicleName.modelKey("Dodge", "Unknown")).toBeNull();
    expect(VehicleName.modelKey("Other", "OTHER")).toBeNull();
    // A pickup is a real model name for these makes.
    expect(VehicleName.modelKey("Nissan", "Pickup")).toBe("PICKUP");
  });

  test("drops the trim, body, drive and year labels yards append", () => {
    for (const model of [
      "Accord EX",
      "Accord EX-L",
      "Accord   CP.",
      "Accord  4DR. LX",
      "ACCORD SDN",
    ])
      expect(VehicleName.modelKey("Honda", model)).toBe("ACCORD");
    for (const model of ["CIVIC4DR.SDN.", "Civic EX 4DR.  SDN.", "Civic 2009"])
      expect(VehicleName.modelKey("Honda", model)).toBe("CIVIC");
    expect(VehicleName.modelKey("Honda", "ODYSSEY SW.")).toBe("ODYSSEY");
    // An old URL slug splits "EX-L" in two.
    expect(VehicleName.modelKey("Honda", "accord ex l")).toBe("ACCORD");
    expect(VehicleName.modelKey("Honda", "ELEMENT SW. 4WD.")).toBe("ELEMENT");
    expect(VehicleName.modelKey("Ford", "F150 XLT")).toBe("F150");
    expect(VehicleName.modelKey("Chevrolet", "Silverado 1500 LT")).toBe(
      "SILVERADO1500",
    );
  });

  test("keeps labels that name a different model", () => {
    expect(VehicleName.modelKey("Honda", "Accord Crosstour")).toBe(
      "ACCORDCROSSTOUR",
    );
    expect(VehicleName.modelKey("Honda", "Civic Hybrid EX-L")).toBe(
      "CIVICHYBRID",
    );
    expect(VehicleName.modelKey("Honda", "Civic Si")).toBe("CIVICSI");
    expect(VehicleName.modelKey("Chevrolet", "Silverado 2500")).toBe(
      "SILVERADO2500",
    );
    // A model that is also a trim label, after its make.
    expect(VehicleName.modelKey("Lexus", "Lexus LS")).toBe("LS");
    expect(VehicleName.modelKey("Lincoln", "LINCOLN LS")).toBe("LS");
    expect(VehicleName.modelKey("Lexus", "LEXUS LX")).toBe("LX");
    // Nothing but a model code would remain.
    expect(VehicleName.modelKey("Mercedes-Benz", "300 SE")).toBe("300SE");
    expect(VehicleName.modelKey("Lincoln", "LS")).toBe("LS");
  });
});

describe("VehicleName.baseModelName", () => {
  test("spells the model without appended labels", () => {
    expect(VehicleName.baseModelName("Honda", "CIVIC4DR.SDN.")).toBe("CIVIC");
    expect(VehicleName.baseModelName("Honda", "Accord  4DR. LX")).toBe(
      "Accord",
    );
    expect(VehicleName.baseModelName("Ford", "FORD F150 XLT")).toBe("F-150");
    expect(VehicleName.baseModelName("Honda", "Pilot")).toBe("Pilot");
    // Dots inside a model stay.
    expect(VehicleName.baseModelName("Ford", "Mustang 5.0 LX")).toBe(
      "Mustang 5.0",
    );
    expect(VehicleName.baseModelName("Lexus", "Lexus LS")).toBe("LS");
  });
});

describe("VehicleName.modelName", () => {
  test("strips a repeated make from the spelling shown", () => {
    expect(VehicleName.modelName("Ford", "FORD F150 PICKUP")).toBe("F-150");
    expect(VehicleName.modelName("Mazda", "MAZDA 3")).toBe("MAZDA 3");
  });
});

test.each([
  ["Nissian", "Nissan"],
  ["Oldmobile", "Oldsmobile"],
  ["Mitsibishi", "Mitsubishi"],
  ["Peterbuilt", "Peterbilt"],
  ["Chevrolette", "Chevrolet"],
  ["Infinity", "Infiniti"],
  ["Datsun - Nissan", "Nissan"],
  ["Range Rover", "Land Rover"],
  ["Mini Cooper", "Mini"],
  ["Ic Corporation", "IC Corporation"],
  ["Volvowhitegmc", "Volvo White GMC"],
])("canonicalizes the evidenced make %s", (raw, expected) => {
  expect(VehicleName.makeName(raw)).toBe(expected);
  expect(VehicleName.makeKey(raw)).toBe(VehicleName.makeKey(expected));
});

test.each([
  ["Ford", "F150", "F-150"],
  ["Ford", "FORD F-150 PICKUP", "F-150"],
  ["Ford", "FORD F100 PICKUP", "F-100"],
  ["Ford", "FORD F250 PICKUP", "F-250"],
  ["Ford", "FORD F250SD PICKUP", "F-250 Super Duty"],
  ["Ford", "F350 SUPER DUTY PICKUP", "F-350 Super Duty"],
  ["Chevrolet", "CHEVROLET SILVERADO 1500 PICKUP", "Silverado 1500"],
  ["Toyota", "TOYOTA T100 PICKUP", "T100"],
  ["Ford", "ford-f150-pickup".replace(/-/g, " "), "F-150"],
  ["Toyota", "TOYOTA TACOMA", "TACOMA"],
  ["Land Rover", "LAND ROVER RANGE ROVER", "RANGE ROVER"],
  ["Land Rover", "Range Rover Sport", "Range Rover Sport"],
  ["Ford", "F150 RAPTOR PICKUP", "F150 RAPTOR PICKUP"],
  ["Chevrolet", "FORD F150 PICKUP", "FORD F150 PICKUP"],
  ["Toyota", "PICKUP", "PICKUP"],
  ["Ford", "CUSTOM PICKUP", "CUSTOM PICKUP"],
  ["Chevrolet", "1500 PICKUP", "1500 PICKUP"],
  ["Dodge", "RAM PICKUP", "RAM PICKUP"],
])("normalizes only clear model identities: %s %s", (make, raw, expected) => {
  expect(VehicleName.modelName(make, raw)).toBe(expected);
});

test("keeps ambiguous makes and distinct historical brands separate", () => {
  expect(VehicleName.makeName("Chevrolet / GMC")).toBe("Chevrolet / GMC");
  expect(VehicleName.makeKey("Volvowhitegmc")).not.toBe(
    VehicleName.makeKey("Volvo"),
  );
  expect(VehicleName.makeKey("IC Corporation")).not.toBe(
    VehicleName.makeKey("International"),
  );
  expect(VehicleName.makeKey("Datsun")).not.toBe(VehicleName.makeKey("Nissan"));
  expect(VehicleName.modelKey("Land Rover", "Range Rover")).toBe("RANGEROVER");
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
  });

  test("title-cases plain words when every spelling is all caps", () => {
    const only = (name: string) =>
      VehicleName.preferredSpelling(new Map([[name, 1]]));
    expect(only("F-250 SUPER DUTY")).toBe("F-250 Super Duty");
    expect(only("CIVIC CRX")).toBe("Civic CRX");
    expect(only("TOWN & COUNTRY")).toBe("Town & Country");
    expect(only("CLARITY")).toBe("Clarity");
    // Initials and model codes keep their capitals.
    expect(only("BMW")).toBe("BMW");
    expect(only("CR-V")).toBe("CR-V");
    expect(only("MAZDA3")).toBe("MAZDA3");
    expect(only("RX 300")).toBe("RX 300");
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

test("display softens all-caps names and leaves the rest alone", () => {
  expect(VehicleName.display("RIVIERA")).toBe("Riviera");
  expect(VehicleName.display("Focus")).toBe("Focus");
  expect(VehicleName.display("SE Hatch")).toBe("SE Hatch");
});

test("displayWhole softens a vehicle's name only when no short word stays caps", () => {
  expect(VehicleName.displayWhole("PASSAT")).toBe("Passat");
  expect(VehicleName.displayWhole("TOWN & COUNTRY")).toBe("Town & Country");
  expect(VehicleName.displayWhole("SANTA FE")).toBe("SANTA FE");
  expect(VehicleName.displayWhole("GRAND AM")).toBe("GRAND AM");
  expect(VehicleName.displayWhole("CR-V")).toBe("CR-V");
  expect(VehicleName.displayWhole("Civic")).toBe("Civic");
});

test("sameSlug ignores hyphens and case", () => {
  expect(VehicleName.sameSlug("mazda3", "mazda-3")).toBe(true);
  expect(VehicleName.sameSlug("civic", "CIVIC")).toBe(true);
  expect(VehicleName.sameSlug("civic", "accord")).toBe(false);
});
