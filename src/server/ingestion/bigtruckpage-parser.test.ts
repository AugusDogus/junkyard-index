import { expect, test } from "bun:test";
import {
  isBigtruckpageDonorUrl,
  parseBigtruckpageCatalog,
} from "./bigtruckpage-parser";
import { transformBigtruckpageRecord } from "./bigtruckpage-transform";
import { bigtruckpageFixture } from "./bigtruckpage-test-fixtures";
import { parseBigtruckpageProfile } from "./bigtruckpage-yard-metadata";

test("native SSR comment boundaries preserve multiword makes and reject the two title conflicts", async () => {
  const pages = await Promise.all(
    [1, 2, 3].map(async (page) =>
      parseBigtruckpageCatalog(await bigtruckpageFixture(page), page),
    ),
  );
  expect(pages.map((page) => page.records.length)).toEqual([20, 20, 10]);
  const results = pages.flatMap((page) =>
    page.records.map(transformBigtruckpageRecord),
  );
  expect(
    results.filter((result) => result.status === "available"),
  ).toHaveLength(48);
  expect(results.filter((result) => result.status === "incomplete")).toEqual([
    { status: "incomplete", vin: "4V4M19EHXHN971866" },
    { status: "incomplete", vin: "1S12E9536PE549310" },
  ]);
  expect(pages[0]?.records[1]).toMatchObject({
    make: "IC BUS",
    model: "PC515",
  });
  expect(pages[2]?.records[0]).toMatchObject({
    make: "WESTERN STAR",
    model: "49X Chassis",
  });
  const staleSlug = pages[1]?.records.find((record) =>
    record.url.endsWith("-447470"),
  );
  expect(staleSlug).toBeDefined();
  if (!staleSlug)
    throw new Error("Missing captured stale-slug regression donor");
  expect(transformBigtruckpageRecord(staleSlug)).toMatchObject({
    status: "available",
    vehicle: {
      model: "579",
      detailsUrl:
        "https://bigtruckpage.com/sellers/misiuk-motors-llc/dismantling-trucks/2016-peterbilt-389-447470",
      stockNumber: null,
    },
  });
});

test("native profile establishes the complete trusted physical tuple", async () => {
  const html = await bigtruckpageFixture("profile");
  expect(parseBigtruckpageProfile(html)).toMatchObject({
    name: "Misiuk Motors LLC",
    address: "101 E Monticello ST Strafford MO 65757",
    phone: "5037805340",
  });
  for (const changed of [
    html.replaceAll("Misiuk Motors LLC", "Other Seller"),
    html.replaceAll("Monticello", "Other"),
    html.replaceAll("Strafford", "Other City"),
    html.replaceAll("65757", "65758"),
    html.replaceAll("503", "504"),
    html.replace(
      '<span class="text-white">101 E Monticello ST Strafford MO 65757</span>',
      '<span class="text-white">Other physical address</span>',
    ),
  ])
    expect(() => parseBigtruckpageProfile(changed)).toThrow();
});

test("each complete donor card binds exactly its native donor and trusted seller links", async () => {
  const html = await bigtruckpageFixture(1);
  const conflicting = html.replace(
    /(<div class="px-2 pb-2 pt-1 sm:px-3 sm:pb-3">)(<a\b[^>]*>[\s\S]*?<\/a>)/,
    '$1$2<a href="/sellers/other">Other Seller</a>',
  );
  expect(() => parseBigtruckpageCatalog(conflicting, 1)).toThrow();
});

test("complete catalog requires all four native filters to be present and unfiltered", async () => {
  const html = await bigtruckpageFixture(1);
  for (const [name, expected, filtered] of [
    ["q", "", "Freightliner"],
    ["vin", "", "1FUBCYD25KHLL0157"],
    ["make", "ALL", "FREIGHTLINER"],
    ["model", "ALL", "M2"],
  ]) {
    const control = `name="${name}" value="${expected}"`;
    expect(html).toContain(control);
    expect(() =>
      parseBigtruckpageCatalog(
        html.replaceAll(control, `name="${name}" value="${filtered}"`),
        1,
      ),
    ).toThrow();
    expect(() =>
      parseBigtruckpageCatalog(
        html.replaceAll(control, `name="missing-${name}"`),
        1,
      ),
    ).toThrow();
  }
  expect(() =>
    parseBigtruckpageCatalog(
      html.replace(
        'name="make" value="ALL"/>',
        'name="make" value="ALL"/><input name="make" value="FREIGHTLINER"/>',
      ),
      1,
    ),
  ).toThrow();
  for (const control of [
    '<input name="year" value="2019"/>',
    '<select name="year"><option selected>2019</option></select>',
  ]) {
    expect(() =>
      parseBigtruckpageCatalog(
        html.replaceAll("</form>", control + "</form>"),
        1,
      ),
    ).toThrow();
  }
});

test("unusable required make and model labels never become canonical donors", async () => {
  const record = parseBigtruckpageCatalog(await bigtruckpageFixture(1), 1)
    .records[0];
  if (!record) throw new Error("Missing captured native record");
  for (const identity of [
    { make: "2020", model: record.model },
    { make: record.make, model: "undefined" },
    { make: record.make, model: "Not Available" },
  ]) {
    expect(
      transformBigtruckpageRecord({
        ...record,
        ...identity,
        label: `Open donor truck: ${identity.make} ${identity.model}`,
        nativeTitle: null,
      }),
    ).toEqual({ status: "incomplete", vin: record.vin });
  }
});

test("native page rejects missing ownership, identity boundaries, gaps and incomplete documents", async () => {
  const html = await bigtruckpageFixture(1);
  for (const changed of [
    html.slice(0, -20),
    html.replace("IC BUS<!-- --> <!-- -->PC515", "IC BUS PC515"),
    html.replace("50<!-- --> donor trucks", "40<!-- --> donor trucks"),
    html.replaceAll(
      'href="/sellers/misiuk-motors-llc/dismantling-trucks?page=2"',
      'href="/sellers/misiuk-motors-llc/dismantling-trucks?page=4"',
    ),
    html.replaceAll(
      'href="/sellers/misiuk-motors-llc"',
      'href="/sellers/other"',
    ),
    html.replace(
      'href="/sellers/misiuk-motors-llc/dismantling-trucks/2019-freightliner-m2-523581"',
      'href="https://example.com/sellers/misiuk-motors-llc/dismantling-trucks/2019-freightliner-m2-523581"',
    ),
    html.replace(
      "Page <!-- -->1<!-- -->/<!-- -->3",
      "Page <!-- -->2<!-- -->/<!-- -->3",
    ),
  ])
    expect(() => parseBigtruckpageCatalog(changed, 1)).toThrow();
  const url =
    "https://bigtruckpage.com/sellers/misiuk-motors-llc/dismantling-trucks/2019-freightliner-m2-523581";
  expect(isBigtruckpageDonorUrl(url)).toBe(true);
  for (const changed of [
    url + "?page=1",
    url + "#x",
    url.replace("/misiuk-motors-llc/", "/other/"),
    url.replace("https:", "http:"),
  ])
    expect(isBigtruckpageDonorUrl(changed)).toBe(false);
});

test("optional photos remain null while generic unrelated title conflicts reject valid VIN presence", async () => {
  const html = await bigtruckpageFixture(1);
  const noImage = html.replace(
    /(<a\b[^>]*aria-label="Open donor truck: FREIGHTLINER M2"[^>]*>)([\s\S]*?)(<\/a>)/,
    (_full: string, open: string, body: string, close: string) =>
      open + body.replace(/<img\b[^>]*>/, "") + close,
  );
  const record = parseBigtruckpageCatalog(noImage, 1).records[0];
  if (!record) throw new Error("Missing captured native record");
  expect(transformBigtruckpageRecord(record)).toMatchObject({
    status: "available",
    vehicle: { imageUrl: null, stockNumber: null },
  });
  expect(
    transformBigtruckpageRecord({ ...record, nativeTitle: "2019 MACK Anthem" }),
  ).toEqual({ status: "incomplete", vin: "1FUBCYD25KHLL0157" });
  expect(
    transformBigtruckpageRecord({
      ...record,
      nativeTitle: "2020 FREIGHTLINER M2",
    }).status,
  ).toBe("incomplete");
  expect(transformBigtruckpageRecord({ ...record, vin: "NOT-A-VIN" })).toEqual({
    status: "incomplete",
    vin: null,
  });
  expect(
    transformBigtruckpageRecord({ ...record, model: "Unknown" }).status,
  ).toBe("incomplete");
});
