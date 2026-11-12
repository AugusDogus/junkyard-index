import { expect, test } from "bun:test";
import {
  mergePontiacMappings,
  pontiacQueries,
  PontiacModelSchema,
} from "./pontiac-catalog";

test("Pontiac preserves year-dependent mapping variants while merging equivalent years", () => {
  const mapping = PontiacModelSchema.parse({
    hollanderModel: "Caprice",
    trueModel: "CAPRICE",
    mmdCD: "GM1",
    mmdCategory: "A",
  });
  const first = { year: 1990, make: "Chevrolet", ...mapping };
  const same = { ...first, year: 1992 };
  const variant = { ...first, year: 1996, mmdCategory: "B" };
  const merged = mergePontiacMappings([first], [same, variant]);
  expect(merged).toHaveLength(2);
  expect(merged[0]?.year).toBe(1992);
  expect(pontiacQueries(merged)).toEqual([
    { year: 1992, make: "Chevrolet", model: "Caprice" },
    { year: 1996, make: "Chevrolet", model: "Caprice" },
  ]);
  expect(
    pontiacQueries([...merged, { ...same, mmdCD: "different" }]),
  ).toHaveLength(2);
});
