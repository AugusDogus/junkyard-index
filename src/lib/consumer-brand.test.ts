import { expect, test } from "bun:test";
import { ConsumerBrand } from "./consumer-brand";

test.each([
  ["Toyota", "Scion tC", "Scion", "Scion", "tC"],
  ["Toyota", "Scion xB", "Toyota", "Scion", "xB"],
  ["Toyota", "TC", "Scion", "Scion", "tC"],
  ["General Motors", "Ion", "Saturn", "Saturn", "Ion"],
  ["GM", "Ion", "Saturn", "Saturn", "Ion"],
  ["Ford", "Sable", "Mercury", "Mercury", "Sable"],
  ["Chrysler", "Voyager", "Plymouth", "Plymouth", "Voyager"],
  ["Chevrolet", "Geo Prizm", "Chevrolet", "Geo", "Prizm"],
  ["Mercedes-Benz", "Fortwo", "Smart", "Smart", "Fortwo"],
  ["Dodge", "1500", "Ram", "Ram", "1500"],
  ["Ram", "1500", "Dodge", "Ram", "1500"],
  ["GMC", "Sonoma", "Chevrolet", "GMC", "Sonoma"],
  ["Chevrolet", "Impala", "Saturn", "Chevrolet", "Impala"],
  ["Mercury", "Sable", "Ford", "Mercury", "Sable"],
  ["Plymouth", "Voyager", "Chrysler", "Plymouth", "Voyager"],
])(
  "consumer brand %s %s from %s",
  (make, model, source, expectedMake, expectedModel) => {
    expect(ConsumerBrand.resolve(make, model, source)).toEqual({
      make: expectedMake,
      model: expectedModel,
    });
  },
);
