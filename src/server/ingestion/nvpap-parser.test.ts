import { expect, test } from "bun:test";
import { parseNvpapPage, type NvpapRecord } from "./nvpap-parser";
import { nvpapTestRecord, nvpapTestResponse } from "./nvpap-test-fixtures";
import { transformNvpapRecord } from "./nvpap-transform";
import { nvpapTestYard } from "./nvpap-test-fixtures";
import { nvpapInventoryUrl } from "./nvpap-yard-metadata";

test("Nevada retains live models absent from the native model directory", () => {
  const parsed = parseNvpapPage(
    nvpapTestResponse([nvpapTestRecord], "1074"),
    "1074",
    1981,
  );
  expect(parsed).toEqual([nvpapTestRecord]);
  const result = transformNvpapRecord(
    parsed[0] ?? nvpapTestRecord,
    nvpapTestYard,
  );
  expect(result.status).toBe("available");
  if (result.status !== "available") throw new Error("Expected complete donor");
  expect(result.vehicle).toMatchObject({
    stockNumber: "L133425",
    model: "CHEVROLET 10 VAN",
    color: "Brown",
    availableDate: "2026-10-20T00:00:00.000Z",
    row: "Row 119",
    imageUrl: nvpapTestRecord.images[0],
    lat: 36.2527229,
    lng: -115.0794377,
  });
  const url = new URL(result.vehicle.detailsUrl ?? "");
  // The source reads the raw substring with atob, without URL decoding.
  expect(JSON.parse(atob(url.href.split("?p=")[1] ?? ""))).toEqual([
    1074,
    1,
    "-2",
    -1,
    -1,
    -1,
  ]);
});

test("Nevada yard links preserve the native loader's raw base64 padding", () => {
  const href = nvpapInventoryUrl("1075");
  expect(href).not.toContain("%3D");
  expect(JSON.parse(atob(href.split("?p=")[1] ?? ""))).toEqual([
    1075,
    1,
    "-2",
    -1,
    -1,
    -1,
  ]);
});

test.each([
  (s: string) => s.slice(1),
  (s: string) => s.slice(0, -1),
  (s: string) =>
    s.replace(
      'data-pt1-vin="2GCEG25H8B4121375"',
      'data-pt1-vin="1GCEG25H8B4121375"',
    ),
  (s: string) => s.replace("1981", "1982"),
  (s: string) => s.replace('id="pt1-row-0"', 'id="pt1-row-1"'),
])(
  "Nevada rejects truncated or contradictory dual-format responses",
  (mutate) => {
    expect(() =>
      parseNvpapPage(
        mutate(nvpapTestResponse([nvpapTestRecord], "1074")),
        "1074",
        1981,
      ),
    ).toThrow();
  },
);
test("Nevada validates yard identity and explicit empty results", () => {
  expect(() =>
    parseNvpapPage(nvpapTestResponse([nvpapTestRecord], "1074"), "1075", 1981),
  ).toThrow();
  expect(parseNvpapPage(nvpapTestResponse([], "1074"), "1074", 1886)).toEqual(
    [],
  );
  expect(() =>
    parseNvpapPage('000000\n{"search_results":[]}', "1074", 1886),
  ).toThrow();
});
test.each([{ model: "UNKNOWN" }, { vin: "INVALID" }, { make: "" }])(
  "Nevada rejects donors missing required identity without inventing fields",
  (change) => {
    expect(
      transformNvpapRecord({ ...nvpapTestRecord, ...change }, nvpapTestYard)
        .status,
    ).toBe("incomplete");
  },
);
test("Nevada admits required identity when all optional metadata is absent", () => {
  const result = transformNvpapRecord(
    {
      ...nvpapTestRecord,
      color: "",
      row: "",
      date: "",
      stock: "",
      images: [],
    },
    nvpapTestYard,
  );
  expect(result.status).toBe("available");
  if (result.status !== "available")
    throw new Error("Expected available donor");
  expect(result.vehicle).toMatchObject({
    vin: nvpapTestRecord.vin,
    year: nvpapTestRecord.year,
    make: "Chevrolet",
    model: nvpapTestRecord.model,
    color: null,
    stockNumber: null,
    row: null,
    availableDate: null,
    imageUrl: null,
    detailsUrl: nvpapInventoryUrl("1074"),
    locationCode: "1074",
  });
});
test.each([
  { change: { color: "Unknown" }, expected: { color: null } },
  { change: { color: "Burnt" }, expected: { color: null } },
  { change: { row: "N/A" }, expected: { row: null } },
  { change: { date: "Feb 30, 2026" }, expected: { availableDate: null } },
  { change: { stock: "[" }, expected: { stockNumber: null, imageUrl: null } },
  {
    change: {
      images: [
        "https://nvpap.com/wp-content/uploads/inventory-images/placeholder.jpg",
      ],
    },
    expected: { imageUrl: null },
  },
  {
    change: {
      images: ["https://example.com/photos/preview_photos/L133425_left.JPG"],
    },
    expected: { imageUrl: null },
  },
  {
    change: {
      images: ["https://nvpap.com/photos/preview_photos/L133426_left.JPG"],
    },
    expected: { imageUrl: null },
  },
])(
  "Nevada nulls unusable optional values without rejecting identity",
  ({ change, expected }) => {
    const result = transformNvpapRecord(
      { ...nvpapTestRecord, ...change },
      nvpapTestYard,
    );
    expect(result.status).toBe("available");
    if (result.status !== "available")
      throw new Error("Expected available donor");
    expect(result.vehicle).toMatchObject(expected);
  },
);
test("Nevada permits omitted optional cells while retaining stock traversal identity", () => {
  const parsed = parseNvpapPage(
    nvpapTestResponse([nvpapTestRecord], "1074", ["color", "row", "date"]),
    "1074",
    1981,
  );
  expect(parsed).toEqual([
    { ...nvpapTestRecord, color: "", row: "", date: "" },
  ]);
});
test.each([{ stock: "" }, { stock: "[" }, { stock: "H133425" }])(
  "Nevada still requires source stock identity for verified enumeration",
  (change) => {
    expect(() =>
      parseNvpapPage(
        nvpapTestResponse([{ ...nvpapTestRecord, ...change }], "1074"),
        "1074",
        1981,
      ),
    ).toThrow("contradictory yard, year, VIN, stock or model identity");
  },
);
function parseFailure(raw: string, year = 1981): string {
  try {
    parseNvpapPage(raw, "1074", year);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("Expected the Nevada page to be rejected");
}
test("Nevada identity rejections name the failed check and the row evidence", () => {
  const message = parseFailure(
    nvpapTestResponse([nvpapTestRecord], "1074").replace(
      "CHEVROLET CHEVROLET 10 VAN",
      "CHEVROLET CHEVROLET 20 VAN",
    ),
  );
  expect(message).toContain("row 0 failed the model cell check");
  expect(message).toContain(
    'JSON {"make":"CHEVROLET","model":"CHEVROLET 10 VAN","year":1981,"vin":"2GCEG25H8B4121375","unlabeled":22,"store":1074}',
  );
  expect(message).toContain(
    'HTML cells stock ["L133425"], year ["1981"], model ["CHEVROLET CHEVROLET 20 VAN"], store ["Las Vegas"], VIN buttons ["2GCEG25H8B4121375"]',
  );
  expect(message).toContain("previously published Nevada inventory");
});
// Live Henderson row: the JSON model is empty and the model cell holds only the make.
const nvpapEmptyModelRecord: NvpapRecord = {
  ...nvpapTestRecord,
  make: "FORD",
  model: "",
  year: 2016,
  vin: "1FTFX1CG9GKE16292",
  stock: "H065832",
  images: [],
};
// Same-length substitution keeps the native length prefix valid.
function emptyModelResponse(cell: string, record = nvpapEmptyModelRecord) {
  const from = ">" + record.make + " " + record.model + "</div>";
  if (cell.length > from.length - 7) throw new Error("Cell would move JSON");
  return nvpapTestResponse([record], "1075").replace(
    from,
    ">" + cell.padEnd(from.length - 7) + "</div>",
  );
}
test("Nevada parses an empty source model whose cell is only the make, then withholds it as incomplete", () => {
  const parsed = parseNvpapPage(emptyModelResponse("Ford"), "1075", 2016);
  expect(parsed).toEqual([nvpapEmptyModelRecord]);
  const result = transformNvpapRecord(nvpapEmptyModelRecord, {
    ...nvpapTestYard,
    code: "1075",
  });
  expect(result).toEqual({ status: "incomplete", vin: "1FTFX1CG9GKE16292" });
});
test.each([
  { cell: "Dodge", record: nvpapEmptyModelRecord },
  { cell: "F150", record: nvpapEmptyModelRecord },
  { cell: "Ford", record: { ...nvpapEmptyModelRecord, model: "F150" } },
])(
  "Nevada still rejects a model cell of $cell for JSON model '$record.model'",
  ({ cell, record }) => {
    expect(() =>
      parseNvpapPage(emptyModelResponse(cell, record), "1075", 2016),
    ).toThrow("row 0 failed the model cell check");
  },
);
test.each([
  {
    raw: nvpapTestResponse([{ ...nvpapTestRecord, stock: "" }], "1074"),
    year: 1981,
    check: "stock format",
  },
  {
    raw: nvpapTestResponse([{ ...nvpapTestRecord, stock: "H133425" }], "1074"),
    year: 1981,
    check: "stock yard prefix",
  },
  {
    raw: nvpapTestResponse([nvpapTestRecord], "1074"),
    year: 1982,
    check: "requested year",
  },
  {
    raw: nvpapTestResponse([nvpapTestRecord], "1074").replace(
      'data-pt1-vin="2GCEG25H8B4121375"',
      'data-pt1-vin="1GCEG25H8B4121375"',
    ),
    year: 1981,
    check: "VIN button value",
  },
])("Nevada names the $check identity check", ({ raw, year, check }) => {
  expect(parseFailure(raw, year)).toContain(
    "row 0 failed the " + check + " check",
  );
});
test("Nevada rejects repeated source stock identities", () => {
  expect(() =>
    parseNvpapPage(
      nvpapTestResponse(
        [nvpapTestRecord, { ...nvpapTestRecord, vin: "1GCEG25H8B4121375" }],
        "1074",
      ),
      "1074",
      1981,
    ),
  ).toThrow("repeated a stock number");
});
test("Nevada validates genuine legacy serials independently from metadata", () => {
  expect(
    transformNvpapRecord(
      { ...nvpapTestRecord, year: 1975, vin: "F10YRV12345" },
      nvpapTestYard,
    ).status,
  ).toBe("available");
  expect(
    transformNvpapRecord(
      { ...nvpapTestRecord, vin: "F10YRV12345" },
      nvpapTestYard,
    ),
  ).toEqual({ status: "incomplete", vin: null });
});
