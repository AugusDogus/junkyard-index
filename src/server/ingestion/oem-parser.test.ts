import { describe, expect, test } from "bun:test";
import { parseOemDirectory, parseOemDonors } from "./oem-parser";
import {
  oemArrivalFixture,
  oemDonorFixture,
  oemF150,
  oemFord,
  oemMakeFixture,
  oemModelFixture,
  oemFixtureDocument,
} from "./oem-test-fixtures";

const context = { kind: "model", make: oemFord, model: oemF150 } as const;
describe("OEM published inventory boundaries", () => {
  test("retains literal native makes/models and diagnostic badge counts", () => {
    expect(parseOemDirectory(oemMakeFixture, { kind: "makes" })).toEqual([
      oemFord,
    ]);
    expect(
      parseOemDirectory(oemModelFixture, { kind: "models", make: oemFord }),
    ).toEqual([oemF150]);
  });
  test("retains native donor fields, image and destination without requiring a virtual-route canonical", () => {
    const page = parseOemDonors(oemDonorFixture, context);
    expect(page.records).toHaveLength(1);
    expect(page.records[0]?.fields).toContainEqual({
      label: "vin",
      value: "1FTMF1KP0RKE76038",
    });
    expect(page.records[0]?.destinations).toEqual([
      "https://oemautorecyclers.com/parts/FORD/FORD_F150_PICKUP/10563/2024",
    ]);
    expect(page.records[0]?.images).toEqual([
      "https://da8h1v3w8q6n5.cloudfront.net/oh40/images/10563/10563_0.jpg",
    ]);
  });
  test("reads the exact native arrival counter without repairing donor boundaries", () => {
    expect(
      parseOemDonors(oemArrivalFixture, { kind: "arrivals" }).records,
    ).toHaveLength(1);
    expect(() =>
      parseOemDonors(
        oemArrivalFixture.replace('id="vehicleCount">1', 'id="vehicleCount">2'),
        { kind: "arrivals" },
      ),
    ).toThrow("count disagrees");
  });
  test("preserves a blank VIN occurrence for later rejection accounting", () => {
    const page = parseOemDonors(
      oemDonorFixture.replace("1FTMF1KP0RKE76038", ""),
      context,
    );
    expect(page.records).toHaveLength(1);
    expect(page.records[0]?.fields).toContainEqual({ label: "vin", value: "" });
  });
  test.each([
    ["foreign owner", oemDonorFixture.replace("'OH40'", "'MI07'")],
    ["truncated document", oemDonorFixture.replace("</html>", "")],
    [
      "foreign donor",
      oemDonorFixture.replaceAll(
        "//oemautorecyclers.com/parts/",
        "//foreign.example/parts/",
      ),
    ],
    ["unclosed donor", oemDonorFixture.replace("</div></div>", "</div>")],
    [
      "new pager",
      oemDonorFixture.replace(
        "</body>",
        '<a rel="next" href="?page=2">Next</a></body>',
      ),
    ],
    [
      "conflicting canonical",
      oemDonorFixture.replace(
        "</head>",
        '<link rel="canonical" href="https://foreign.example/"></head>',
      ),
    ],
  ])("stops on %s", (_label, raw) => {
    expect(() => parseOemDonors(raw, context)).toThrow();
  });
  test("does not infer an empty page from missing inventory", () => {
    expect(() => parseOemDonors(oemMakeFixture, context)).toThrow(
      "no empty result",
    );
  });
  test("requires the complete native empty-result alert", () => {
    const empty =
      '<div class="alert alert-warning m-3 text-center" role="alert"><h3>No Results Found. Try Browsing Our Parts Or Search Again</h3></div>';
    expect(parseOemDonors(oemFixtureDocument(empty), context).nativeEmpty).toBe(
      true,
    );
    expect(() =>
      parseOemDonors(
        oemDonorFixture.replace("</body>", empty + "</body>"),
        context,
      ),
    ).toThrow("do not reconcile");
    expect(() =>
      parseOemDonors(
        oemFixtureDocument(
          "<p>No Results Found. Try Browsing Our Parts Or Search Again</p>",
        ),
        context,
      ),
    ).toThrow("no empty result");
  });
  test("does not silently omit a foreign or uncounted menu control", () => {
    expect(() =>
      parseOemDirectory(
        oemModelFixture.replace("FORD/FORD_F150_PICKUP", "HONDA/ACCORD"),
        { kind: "models", make: oemFord },
      ),
    ).toThrow("make parent");
    expect(() =>
      parseOemDirectory(
        oemMakeFixture.replace('class="badge badge-light"', 'class="changed"'),
        { kind: "makes" },
      ),
    ).toThrow("label/count");
  });
});
