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
