import { expect, test } from "bun:test";
import { alliedInventoryVin } from "./allied-vin";

test("Allied checks modern VIN digits while retaining valid older serials", () => {
  expect(alliedInventoryVin("2HGFC4B59HH300968", "2017")).toBe(
    "2HGFC4B59HH300968",
  );
  expect(alliedInventoryVin("4S3BH635136300792", "2003")).toBeNull();
  expect(alliedInventoryVin("12345678901234567", "2005")).toBeNull();
  expect(alliedInventoryVin("00000000000000000", "2005")).toBeNull();
  expect(alliedInventoryVin("96969696969696969", "2005")).toBeNull();
  expect(alliedInventoryVin("4J332624", "1955")).toBe("4J332624");
  expect(alliedInventoryVin("4J332624", "2005")).toBeNull();
});
