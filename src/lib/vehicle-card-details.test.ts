import { expect, test } from "bun:test";
import { VehicleCardDetails } from "./vehicle-card-details";

test("position leaves out a row the yard lists as 0", () => {
  expect(
    VehicleCardDetails.position({ section: "", row: "0", space: "" }),
  ).toBe("");
  expect(
    VehicleCardDetails.position({ section: "Cars", row: "00", space: "6" }),
  ).toBe("Section Cars · Space 6");
  expect(
    VehicleCardDetails.position({ section: "", row: "10", space: "" }),
  ).toBe("Row 10");
});
