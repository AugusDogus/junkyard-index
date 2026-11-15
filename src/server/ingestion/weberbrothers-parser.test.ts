import { expect, test } from "bun:test";
import {
  parseWeberbrothersCatalog,
  parseWeberbrothersDetail,
  weberbrothersImageBound,
} from "./weberbrothers-parser";
import { transformWeberbrothersRecord } from "./weberbrothers-transform";
import {
  weberbrothersFixturePost as post,
  weberbrothersFixtureRoot as root,
  weberbrothersFixtureListing as listing,
  weberbrothersFixtureDetail as detail,
  weberbrothersFixtureRecord as record,
} from "./weberbrothers-test-fixtures";

test("native donor ID, literal destination and title bind catalog to detail", () => {
  expect(parseWeberbrothersCatalog(listing(), root).posts).toEqual([post]);
  const parsed = parseWeberbrothersDetail(detail(), post);
  expect(parsed.heading).toBe(post.title);
  expect(parsed.fields.VIN).toBe("5N1AZ3BS4SC111240");
  expect(() =>
    parseWeberbrothersDetail(
      detail().replace('id="product-1908003"', 'id="product-999"'),
      post,
    ),
  ).toThrow("native product ID");
  expect(() =>
    parseWeberbrothersDetail(
      detail({ ...post, title: "2026 NISSAN MURANO SV" }),
      post,
    ),
  ).toThrow("heading or stock changed");
});
test("simple donors qualify and component rows cannot supply donor identity", () => {
  const result = transformWeberbrothersRecord(record(post, { grouped: false }));
  expect(result.status).toBe("available");
  if (result.status === "available") {
    expect(result.vehicle.year).toBe(2025);
    expect(result.vehicle.make).toBe("Nissan");
    expect(result.vehicle.color).toBe("Super Black");
    expect(result.vehicle.availableDate).toBe("2026-11-13");
  }
});
test("native malformed years remain rejected despite independently valid VINs", () => {
  for (const title of [
    "20225 MAZDA CX-90 PREFERRED",
    "20107 NISSAN PATHFINDER",
    "MASERATI LEVANTE BASE",
  ]) {
    const result = transformWeberbrothersRecord(record({ ...post, title }));
    expect(result).toEqual({
      status: "rejected",
      reason: "invalid_required_identity",
      observedVins: ["5N1AZ3BS4SC111240"],
    });
  }
});
test("make typos and missing makes are never repaired with models or URLs", () => {
  for (const title of [
    "2026 HYNDAI ELANTRA N MODEL",
    "2026 ROGUE SV",
    "2024 MAXZD CX-90 PREFERRED",
  ])
    expect(
      transformWeberbrothersRecord(record({ ...post, title })).status,
    ).toBe("rejected");
});
test("nullable optional fields preserve source identity without placeholder values", () => {
  const native = record(
    { ...post, stock: "" },
    { color: "Unknown", arrival: "02/30/2026" },
  );
  const result = transformWeberbrothersRecord({
    ...native,
    images: ["https://weberbrothersauto.s3.amazonaws.com/2026/11/OTHER-1.jpg"],
  });
  expect(result.status).toBe("available");
  if (result.status === "available")
    for (const key of [
      "color",
      "stockNumber",
      "imageUrl",
      "availableDate",
      "row",
      "section",
      "space",
    ] as const)
      expect(result.vehicle[key]).toBeNull();
});
test("absent stock elements do not become a required-field gate", () => {
  const noStock = { ...post, stock: "" };
  const withoutSku = detail(noStock).replace(
    /<div class="sku">[\s\S]*?<\/div>/,
    "",
  );
  const parsed = parseWeberbrothersDetail(withoutSku, noStock);
  const result = transformWeberbrothersRecord(parsed);
  expect(result.status).toBe("available");
  if (result.status === "available")
    expect(result.vehicle.stockNumber).toBeNull();
  expect(
    parseWeberbrothersCatalog(
      listing([noStock]).replace(/<div class="sku">[\s\S]*?<\/div>/, ""),
      root,
    ).posts[0]?.stock,
  ).toBe("");
  const detailMissing = detail().replace(
    /<div class="sku">[\s\S]*?<\/div>/,
    "",
  );
  expect(parseWeberbrothersDetail(detailMissing, post).stock).toBe(post.stock);
});
test("photos require native storage and exact stock token binding", () => {
  expect(
    weberbrothersImageBound(
      "https://weberbrothersauto.s3.amazonaws.com/2026/10/B2A319_0.jpg",
      "B2A319",
    ),
  ).toBe(true);
  expect(
    weberbrothersImageBound(
      "https://weberbrothersauto.s3.amazonaws.com/2026/11/B2B370-1.jpg",
      "B2B370",
    ),
  ).toBe(true);
  expect(
    weberbrothersImageBound(
      "https://i0.wp.com/weberbrothersauto.s3.amazonaws.com/2023/10/Nissan-Murano-B2B370-10-scaled.jpg?fit=2560%2C1920&ssl=1",
      "B2B370",
    ),
  ).toBe(true);
  for (const image of [
    "https://weberbrothersauto.s3.amazonaws.com/2026/11/B2A365-1.jpg",
    "https://weberbrothersauto.s3.amazonaws.com.evil.test/2026/11/B2B370-1.jpg",
    "https://example.com/B2B370-1.jpg",
  ])
    expect(weberbrothersImageBound(image, "B2B370")).toBe(false);
});
test("source denial, truncation, duplicate fields and non-native destinations fail closed", () => {
  expect(() =>
    parseWeberbrothersDetail(detail().replace("</html>", ""), post),
  ).toThrow("truncated");
  expect(() =>
    parseWeberbrothersDetail(
      detail().replace("<html>", "<html><title>Access Denied</title>"),
      post,
    ),
  ).toThrow("access content");
  expect(() =>
    parseWeberbrothersDetail(
      detail().replace("<strong>Comments:</strong>", "<strong>VIN:</strong>"),
      post,
    ),
  ).toThrow("Duplicate Weber native field");
  expect(() =>
    parseWeberbrothersCatalog(
      listing().replaceAll(post.url, "https://foreign.example/product/x/"),
      root,
    ),
  ).toThrow();
});
test("native explicit comment VIN conflicts reject, component sold signals do not remove donors", () => {
  expect(
    transformWeberbrothersRecord(
      record(post, { comments: "VIN: JM3KKBHD6S1200827" }),
    ),
  ).toEqual({
    status: "rejected",
    reason: "conflicting_native_vin",
    observedVins: ["5N1AZ3BS4SC111240", "JM3KKBHD6S1200827"],
  });
  expect(
    transformWeberbrothersRecord(
      record(post, { comments: "Engine sold, other parts available" }),
    ).status,
  ).toBe("available");
  expect(
    transformWeberbrothersRecord(
      record(post, { comments: "Whole vehicle sold" }),
    ).status,
  ).toBe("rejected");
});
