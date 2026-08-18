import { describe, expect, test } from "bun:test";
import { Effect, Schema } from "effect";
import { TapInventorySearchProductSchema } from "./tap-inventory-client";

describe("TapInventorySearchProductSchema", () => {
  test("accepts a provider record without unused metadata fields", async () => {
    const product = await Effect.runPromise(
      Schema.decodeUnknown(TapInventorySearchProductSchema)({
        stocknumber: "DMI033764",
        iyear: "2002",
        make: "FORD",
        model: "TAURUS",
        vehicle_row: "0",
        color: "UNKNOWN",
        vin: "1FAFP55222A222779",
        image_url: "",
      }),
    );

    expect(product).toEqual({
      stocknumber: "DMI033764",
      iyear: "2002",
      make: "FORD",
      model: "TAURUS",
      vehicle_row: "0",
      color: "UNKNOWN",
      vin: "1FAFP55222A222779",
      image_url: "",
    });
  });
});
