import { expect, test } from "bun:test";
import {
  parsePipesConfig,
  parsePipesDirections,
  parsePipesInventory,
  parsePipesOwner,
  parsePipesSearch,
} from "./pipes-parser";
import {
  pipesTestConfig,
  pipesTestDirections,
  pipesTestInventory,
  pipesTestNative,
  pipesTestOwner,
  pipesTestRecord,
  pipesTestSearch,
} from "./pipes-test-fixtures";
import { transformPipesRecord } from "./pipes-transform";

test("Pipes parses its owned native donor and uses whole native YMM with real optional fields", () => {
  parsePipesOwner(pipesTestOwner);
  parsePipesDirections(pipesTestDirections);
  parsePipesConfig(pipesTestConfig);
  const table = parsePipesInventory(pipesTestInventory(), "FORD");
  expect(table).toEqual({ makes: ["FORD"], rows: [pipesTestNative] });
  const [record] = parsePipesSearch(
    pipesTestSearch([
      { ...pipesTestRecord, make: "OTHER API MAKE", model: "OTHER API MODEL" },
    ]),
    pipesTestNative,
  );
  expect(transformPipesRecord(pipesTestNative, record)).toMatchObject({
    status: "available",
    vehicle: {
      make: "Ford",
      model: "FOCUS",
      engine: "L4, 2.0L",
      imageUrl: pipesTestNative.photos[0],
      availableDate: "2026-11-03",
    },
  });
});
test("Pipes retains native model rejects and missing enrichment without manufacturing identity", () => {
  const native = { ...pipesTestNative, model: "" };
  expect(
    parsePipesInventory(pipesTestInventory([native]), "FORD").rows,
  ).toEqual([native]);
  expect(transformPipesRecord(native, pipesTestRecord)).toEqual({
    status: "incomplete",
    reason: "native_required_fields",
    vin: "1FAHP3FN0AW123456",
  });
  expect(transformPipesRecord(pipesTestNative, undefined)).toEqual({
    status: "incomplete",
    reason: "identity_unavailable",
    vin: null,
  });
});
test("Pipes supports only the observed recency extension and preserves literal offset dates", () => {
  const extra = {
    ...pipesTestRecord,
    recencyAnchor: "2026-11-11T17:00:00-06:00",
    dateAdded: "2026-07-07T07:00:35.301260+00:00",
  };
  const [record] = parsePipesSearch(pipesTestSearch([extra]), pipesTestNative);
  expect(record).toEqual(extra);
  expect(
    transformPipesRecord(
      {
        ...pipesTestNative,
        arrivalDate: "01/01/0001",
        reference: "SHELL",
        color: "UNKNOWN",
      },
      record,
    ),
  ).toMatchObject({
    status: "available",
    vehicle: { availableDate: extra.dateAdded, engine: null, color: null },
  });
  expect(() =>
    parsePipesSearch(
      pipesTestSearch([{ ...extra, ...{ unexpected: true } }]),
      pipesTestNative,
    ),
  ).toThrow();
});
test("Pipes refuses truncated native and partial/foreign public boundaries", () => {
  expect(() =>
    parsePipesInventory(pipesTestInventory().replace("</td>", ""), "FORD"),
  ).toThrow();
  expect(() =>
    parsePipesInventory(
      pipesTestInventory().replace("../", "foreign/"),
      "OTHER",
    ),
  ).toThrow();
  expect(() =>
    parsePipesSearch(
      pipesTestSearch().replace('"match_count":1', '"match_count":2'),
      pipesTestNative,
    ),
  ).toThrow();
  expect(() =>
    parsePipesSearch(
      pipesTestSearch().replace("Pipes Shreveport", "Pickers Reno"),
      pipesTestNative,
    ),
  ).toThrow();
  expect(() =>
    parsePipesConfig(
      pipesTestConfig.replace(
        '"hide_vehicle_search":false',
        '"hide_vehicle_search":true',
      ),
    ),
  ).toThrow();
});
test("Pipes refuses an adjacent next-page control and ignores inert donor markup", () => {
  const page = pipesTestInventory();
  expect(() =>
    parsePipesInventory(
      page.replace(
        "</table>",
        '</table><a rel="next" href="/Home/Inventory?page=2">Next</a>',
      ),
      "FORD",
    ),
  ).toThrow("pagination");
  expect(() =>
    parsePipesInventory(
      page
        .replace("<table>", "<template><table>")
        .replace("</table>", "</table></template>"),
      "FORD",
    ),
  ).toThrow("table");
});
