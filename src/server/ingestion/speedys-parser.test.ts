import { describe, expect, test } from "bun:test";
import { parseSpeedysCatalog, parseSpeedysDetail } from "./speedys-parser";
import { speedysSaved } from "./speedys-test-fixtures";
import { SPEEDYS_CATALOG } from "./speedys-yard-metadata";

describe("Speedys native parser", () => {
  test("reads the complete native roster and preserves authoritative headings", () => {
    const catalog = parseSpeedysCatalog(speedysSaved.default, SPEEDYS_CATALOG);
    expect(catalog.categories).toEqual([
      { id: "478", make: "NISSAN", count: 1 },
    ]);
    const post = catalog.posts[0];
    expect(post).toEqual({
      id: "1",
      url: "https://parts.speedysgroup.com/car/?car=1",
      year: "2011",
      make: "NISSAN",
      model: "Rogue",
    });
    if (!post) throw new Error("Missing saved donor");
    const detail = parseSpeedysDetail(speedysSaved.detail, post);
    expect(detail.claims.make).toEqual(["NISSAN", "NISSAN"]);
    expect(detail.claims.model).toEqual(["Rogue", "Rogue"]);
    expect(detail.claims.vin).toEqual(["JN8AS5MV6BW668679"]);
    expect(detail.claims.stock).toEqual(["1"]);
  });
  test.each([
    [
      "pagination",
      speedysSaved.default.replace(
        '<ul class="pagination justify-content-end">',
        '<ul class="pagination justify-content-end"><li><a href="?cat=0&pag=1">2</a></li>',
      ),
    ],
    [
      "hidden filter",
      speedysSaved.default.replace(
        '<h6 class="btn-primary',
        '<input type="hidden" name="status" value="active"><h6 class="btn-primary',
      ),
    ],
    [
      "new scope link",
      speedysSaved.default.replace(
        'href="?cat=0&pag=0"',
        'href="?cat=0&pag=0&stock=all"',
      ),
    ],
    ["truncation", speedysSaved.default.replace("</html>", "")],
  ])("holds unsupported %s before claiming completeness", (_name, raw) => {
    expect(() => parseSpeedysCatalog(raw, SPEEDYS_CATALOG)).toThrow();
  });
  test("joins detail identity and handles a native donor ID other than one", () => {
    const post = parseSpeedysCatalog(
      speedysSaved.default.replaceAll("?car=1", "?car=27"),
      SPEEDYS_CATALOG,
    ).posts[0];
    if (!post) throw new Error("Missing changed donor fixture");
    expect(() => parseSpeedysDetail(speedysSaved.detail, post)).toThrow(
      /inventory ID/,
    );
    expect(
      parseSpeedysDetail(
        speedysSaved.detail.replace("Inventory #1", "Inventory #27"),
        post,
      ).claims.stock,
    ).toEqual(["27"]);
  });
});
