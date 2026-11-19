import { expect, test } from "bun:test";
import { ConsumerModel } from "./consumer-model";

test.each([
  [
    { make: "Chevrolet", model: "GMT-400", series: "1500", driveType: "4x2" },
    "C1500",
  ],
  [
    {
      make: "Chevrolet",
      model: "GMT-400",
      series: "1/2 Ton Nominal",
      driveType: "4WD/4-Wheel Drive/4x4",
    },
    "K1500",
  ],
  [{ make: "Chevrolet", model: "GMT-400", series: "1500" }, "C/K 1500"],
  [
    { make: "Chevrolet", model: "GMT-400", series: "3/4 Ton Nominal" },
    "C/K 2500",
  ],
  [
    { make: "Chevrolet", model: "Silverado", series: "1500 (1/2 Ton)" },
    "Silverado 1500",
  ],
  [
    { make: "Chevrolet", model: "Silverado", series: "2500HD" },
    "Silverado 2500HD",
  ],
  [
    { make: "Chevrolet", model: "Silverado", sourceModel: "SILVRDO15" },
    "Silverado 1500",
  ],
  [{ make: "Honda", model: "Civic", series: "Hybrid" }, "Civic Hybrid"],
  [{ make: "Honda", model: "Civic", trim: "Hybrid" }, "Civic Hybrid"],
  [
    {
      make: "Honda",
      model: "Civic",
      electrificationLevel: "Strong HEV (Hybrid Electric Vehicle)",
    },
    "Civic Hybrid",
  ],
  [
    { make: "Honda", model: "Civic", sourceModel: "Civic Hybrid" },
    "Civic Hybrid",
  ],
  [{ make: "Honda", model: "Civic", trim: "SI" }, "Civic Si"],
  [
    { make: "Ford", model: "F-250", series: "Super Duty - Single Rear Wheel" },
    "F-250 Super Duty",
  ],
  [{ make: "Ford", model: "F-250", sourceModel: "F250SD" }, "F-250 Super Duty"],
  [{ make: "Chevrolet", model: "S-10 Pickup" }, "S-10"],
  [{ make: "Chevrolet", model: "Astro Van" }, "Astro"],
  [
    { make: "Chevrolet", model: "Astro Van", sourceModel: "Astro Van" },
    "Astro",
  ],
  [
    { make: "Chevrolet", model: "S-10 Pickup", sourceModel: "S-10 Pickup" },
    "S-10",
  ],
  [
    { make: "Chevrolet", model: "Express", sourceModel: "EXPRESS 1500" },
    "Express 1500",
  ],
  [
    { make: "Chevrolet", model: "Suburban", series: "2500 (3/4 Ton)" },
    "Suburban 2500",
  ],
  [{ make: "GMC", model: "Savana", series: "3500 (1 Ton)" }, "Savana 3500"],
  [{ make: "Toyota", model: "Corolla Matrix" }, "Matrix"],
  [{ make: "Toyota", model: "Camry Solara" }, "Solara"],
  [{ make: "Ford", model: "F-150", sourceModel: "F150NEW" }, "F-150"],
  [
    {
      make: "Chevrolet",
      model: "Silverado",
      series: "1500",
      sourceModel: "Silverado 1500 Classic",
    },
    "Silverado 1500 Classic",
  ],
  [{ make: "Chevrolet", model: "GMT-400", sourceModel: "K1500" }, "K1500"],
  [
    {
      make: "Chevrolet",
      model: "GMT-400",
      sourceModel: "Unidentified special truck",
    },
    "Unidentified special truck",
  ],
  [
    { make: "Honda", model: "Civic", sourceModel: "Civic Type R" },
    "Civic Type R",
  ],
  [
    {
      make: "Chevrolet",
      model: "Silverado",
      series: "1500",
      sourceModel: "Silverado Classic 1500",
    },
    "Silverado Classic 1500",
  ],
  [
    {
      make: "Chevrolet",
      model: "Silverado",
      series: "2500",
      sourceModel: "Silverado 2500HD",
    },
    "Silverado 2500HD",
  ],
  [
    {
      make: "Chevrolet",
      model: "Silverado",
      series: "2500HD",
      sourceModel: "Silverado Classic 2500",
    },
    "Silverado Classic 2500HD",
  ],
  [
    {
      make: "Chevrolet",
      model: "Silverado",
      series: "1500",
      sourceModel: "Silverado Classic",
    },
    "Silverado 1500 Classic",
  ],
  [
    { make: "Chevrolet", model: "Silverado HD", sourceModel: "SILVRDO25" },
    "Silverado 2500HD",
  ],
  [
    {
      make: "Chevrolet",
      model: "R Conventional",
      series: "1/2 Ton Nominal",
      sourceModel: "R10",
    },
    "R10",
  ],
  [
    {
      make: "Chevrolet",
      model: "V Conventional",
      series: "3/4 Ton Nominal",
      sourceModel: "V20",
    },
    "V20",
  ],
  [
    {
      make: "Chevrolet",
      model: "GMT-400",
      series: "1500",
      sourceModel: "K1500",
    },
    "K1500",
  ],
  [
    {
      make: "Chevrolet",
      model: "GMT-400",
      series: "1500",
      sourceModel: "K1500",
      driveType: "4x2",
    },
    "C1500",
  ],
  [
    {
      make: "Chevrolet",
      model: "GMT-400",
      series: "unrecognized",
      sourceModel: "K1500",
    },
    "K1500",
  ],
  [
    {
      make: "Chevrolet",
      model: "Silverado",
      series: "1500",
      sourceModel: "Silverado 2007",
    },
    "Silverado 1500",
  ],
])("consumer names preserve parts-relevant identity: %j", (input, expected) => {
  expect(ConsumerModel.resolve(input)).toBe(expected);
});
