import { expect, test } from "bun:test";
import { auditVinModelUrls } from "../../../scripts/vin-model-url-audit";
import { VinDecode } from "./vin-decode";

const first = { vin: "1FTPW14506KD19655", year: 2006 };
const second = { vin: "1FTPW14606KD19655", year: 2006 };

test("sample audit accounts for unchanged, canonical, ambiguous and retired indexed URLs", () => {
  const models = [
    ["yard", "1", "Chevrolet", "SILVRDO15", 40, 2006, 2006],
    ["yard", "1", "Chevrolet", "OLDTRUCK", 40, 2006, 2006],
    ["yard", "1", "Chevrolet", "Retired", 40, 2006, 2006],
  ];
  const sample = [
    { ...first, make: "Chevrolet", model: "SILVRDO15", count: 40 },
    { ...first, make: "Chevrolet", model: "OLDTRUCK", count: 20 },
    { ...second, make: "Chevrolet", model: "OLDTRUCK", count: 20 },
  ];
  const decoded = new Map(
    [first, second].flatMap((row, i) => {
      const id = VinDecode.identity(row.vin, row.year);
      return id
        ? [
            [
              id.key,
              {
                ...row,
                make: "Chevrolet",
                model: "Silverado",
                series: i === 0 ? "1500" : "2500",
                trim: null,
              },
            ] as const,
          ]
        : [];
    }),
  );
  const result = auditVinModelUrls(
    [
      {
        key: "v3:make-counts",
        data: JSON.stringify([{ make: "Chevrolet", count: 120 }]),
      },
      { key: "v3:make-models:CHEVROLET", data: JSON.stringify(models) },
      {
        key: "v2:make-counts",
        data: JSON.stringify([{ make: "Retired", count: 40 }]),
      },
      {
        key: "v2:make-models:RETIRED",
        data: JSON.stringify([["yard", "1", "Retired", "Old", 40, 1990, 1990]]),
      },
    ],
    [
      { make: "Chevrolet", model: "SILVRDO15", count: 40 },
      { make: "Chevrolet", model: "OLDTRUCK", count: 40 },
      { make: "Chevrolet", model: "Retired", count: 40 },
    ],
    sample,
    decoded,
  );
  expect(result).toMatchObject({
    retainedModelUrls: 4,
    indexedModelUrls: 4,
    unchangedModelUrls: 1,
    redirectCount: 3,
    indexedRedirects: 3,
    modelRedirects: 1,
    parentRedirects: 2,
    unresolved: 0,
  });
  expect(result.redirects).toContainEqual({
    from: "/cars/chevrolet/silvrdo15",
    to: "/cars/chevrolet/silverado-1500",
    indexed: true,
    kind: "model",
  });
  expect(result.redirects).toContainEqual({
    from: "/cars/chevrolet/oldtruck",
    to: "/cars/chevrolet",
    indexed: true,
    kind: "parent",
  });
  expect(result.redirects).toContainEqual({
    from: "/cars/retired/old",
    to: "/cars",
    indexed: true,
    kind: "parent",
  });
});
