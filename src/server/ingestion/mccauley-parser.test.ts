import { describe, expect, test } from "bun:test";
import { MccauleyCursorSchema } from "./mccauley-cursor";
import {
  isMccauleyDetailUrl,
  parseMccauleyCatalog,
  parseMccauleyCurrent,
  parseMccauleyDetail,
} from "./mccauley-parser";
import {
  mccauleyDetailRecords,
  transformMccauleyRecord,
} from "./mccauley-record";
import {
  mccauleySnapshot,
  validateMccauleySnapshot,
} from "./mccauley-snapshot";
import {
  mccauleyCatalogHtml,
  mccauleyCurrentHtml,
  mccauleyDetailHtml,
  mccauleyNativeDetails,
} from "./mccauley-test-fixtures";

const catalog = () => parseMccauleyCatalog(mccauleyCatalogHtml());
const current = () => parseMccauleyCurrent(mccauleyCurrentHtml());
const details = () =>
  mccauleyNativeDetails.map((item) =>
    parseMccauleyDetail(mccauleyDetailHtml(item), {
      url: item.url,
      label: item.label,
    }),
  );

describe("McCauley native census", () => {
  test("retains every native donor, both Calibers, sold components and one unnamed MDX rejection", () => {
    const snapshot = mccauleySnapshot(current(), details());
    expect(catalog().posts).toHaveLength(20);
    expect(snapshot.vehicles).toHaveLength(24);
    expect(snapshot.accounting).toEqual({
      recordsProcessed: 27,
      recordsExcluded: 0,
      recordsRejected: 1,
      duplicateVehicles: 2,
    });
    expect(
      snapshot.vehicles.filter((v) => v.transmission === "Automatic"),
    ).toHaveLength(18);
    expect(
      snapshot.vehicles
        .filter((v) => v.model === "Caliber")
        .map((v) => v.color)
        .sort(),
    ).toEqual(["Red", "Silver"]);
    expect(snapshot.vehicles.some((v) => v.model === "Silverado 2500HD")).toBe(
      true,
    );
    expect(snapshot.vehicles.some((v) => v.vin === "JF1GJAA68DH026959")).toBe(
      true,
    );
    expect(
      snapshot.vehicles.every(
        (v) =>
          v.stockNumber === null &&
          v.imageUrl === null &&
          v.availableDate === null &&
          v.row === null,
      ),
    ).toBe(true);
    expect(() => validateMccauleySnapshot(snapshot)).not.toThrow();
  });

  test("counts blank native VINs and rejects conflicting required identity", () => {
    const first = details().at(0);
    if (!first) throw new Error("Missing native MDX fixture");
    const blank = {
      ...first,
      paragraphs: first.paragraphs.map((p) =>
        p.replace("2HNYD18893H514298", ""),
      ),
    };
    const record = mccauleyDetailRecords(blank).records.at(0);
    if (!record) throw new Error("Missing native VIN observation");
    expect(transformMccauleyRecord(record)).toEqual({
      status: "incomplete",
      vin: null,
    });
    expect(mccauleyDetailRecords(blank).missingIdentities).toBe(1);
    expect(
      transformMccauleyRecord({
        ...record,
        vin: "2HNYD18893H514298",
        listingLabel: "2004 MDX",
      }).status,
    ).toBe("incomplete");
    for (const count of [
      "three",
      "five",
      "six",
      "ten",
      "twenty-one",
      "a dozen",
      "11",
    ])
      expect(() =>
        mccauleyDetailRecords({
          ...first,
          paragraphs: first.paragraphs.map((p) =>
            p.replace("We have two", "We have " + count),
          ),
        }),
      ).toThrow("cardinality");
    expect(() =>
      mccauleyDetailRecords({ ...first, heading: "2004 ACURA MDX" }),
    ).toThrow("conflicts");
  });

  test("only accepts published HTTP detail routes and labelled empty aliases", () => {
    const post = catalog().posts.at(0);
    if (!post) throw new Error("Missing native route fixture");
    expect(isMccauleyDetailUrl(post.url)).toBe(true);
    for (const url of [
      post.url.replace("http:", "https:"),
      post.url + "?x=1",
      post.url + "#x",
      post.url.replace("fatcow.com", "fatcow.com.evil.test"),
    ])
      expect(isMccauleyDetailUrl(url)).toBe(false);
    expect(
      parseMccauleyCatalog(
        mccauleyCatalogHtml().replace(
          "</body>",
          `<a href="${post.url}"></a></body>`,
        ),
      ).posts,
    ).toHaveLength(20);
    expect(() =>
      parseMccauleyCatalog(
        mccauleyCatalogHtml().replace(
          "</body>",
          '<a href="http://mccauleysautocom.fatcow.com/mccauleysauto/parts-unknown.html"></a></body>',
        ),
      ),
    ).toThrow("unlabelled");
  });

  test("fails malformed documents, out-of-card identity, out-of-paragraph VIN and whole-donor removal", () => {
    expect(() =>
      parseMccauleyCurrent(mccauleyCurrentHtml().replace("</html>", "")),
    ).toThrow("truncated");
    expect(() =>
      parseMccauleyCurrent(
        mccauleyCurrentHtml().replace(
          "</body>",
          "<h3>Vehicle 006 2000 Kia Forte</h3></body>",
        ),
      ),
    ).toThrow("outside");
    const item = mccauleyNativeDetails.at(0);
    if (!item) throw new Error("Missing native detail fixture");
    const post = { url: item.url, label: item.label };
    expect(
      parseMccauleyDetail(
        mccauleyDetailHtml(item).replace(
          "</body>",
          "<h2>ENGINE - SOLD</h2></body>",
        ),
        post,
      ).heading,
    ).toBe(item.heading);
    expect(() =>
      parseMccauleyDetail(
        mccauleyDetailHtml(item).replace(
          "</body>",
          "<h2>2004 ACURA MDX</h2></body>",
        ),
        post,
      ),
    ).toThrow("one native");
    expect(() =>
      parseMccauleyDetail(
        mccauleyDetailHtml(item).replace(
          "</body>",
          "VIN: 2HNYD18893H514298</body>",
        ),
        post,
      ),
    ).toThrow("grammar");
    expect(() =>
      parseMccauleyDetail(
        mccauleyDetailHtml({
          ...item,
          paragraphs: [...item.paragraphs, "Vehicle has been sold"],
        }),
        post,
      ),
    ).toThrow("availability");
  });

  test("checks native projection integrity, prefix order, quality floors and rejection ratios", () => {
    const cursor = {
      source: "mccauley",
      version: 1,
      phase: "verify-index",
      catalog: catalog(),
      current: current(),
      details: details(),
    } as const;
    expect(MccauleyCursorSchema.safeParse(cursor).success).toBe(true);
    for (const changed of [
      {
        ...cursor,
        current: {
          ...cursor.current,
          headings: [
            "Vehicle 001 2004 Acura MDX",
            ...cursor.current.headings.slice(1),
          ],
        },
      },
      {
        ...cursor,
        details: cursor.details.map((detail, i) =>
          i === 0 ? { ...detail, heading: "2004 ACURA MDX" } : detail,
        ),
      },
      { ...cursor, details: [...cursor.details].reverse() },
      {
        ...cursor,
        catalog: { ...cursor.catalog, posts: cursor.catalog.posts.slice(1) },
      },
    ])
      expect(MccauleyCursorSchema.safeParse(changed).success).toBe(false);
    const snapshot = mccauleySnapshot(current(), details());
    expect(() =>
      validateMccauleySnapshot({
        ...snapshot,
        vehicles: snapshot.vehicles.slice(0, 7),
        accounting: {
          recordsProcessed: 7,
          recordsRejected: 0,
          duplicateVehicles: 0,
          recordsExcluded: 0,
        },
      }),
    ).toThrow("8-donor minimum");
    expect(() =>
      validateMccauleySnapshot({
        ...snapshot,
        accounting: {
          ...snapshot.accounting,
          recordsProcessed: 30,
          recordsRejected: 4,
        },
      }),
    ).toThrow("10%");
    expect(() =>
      validateMccauleySnapshot({
        ...snapshot,
        accounting: {
          ...snapshot.accounting,
          recordsProcessed: 35,
          duplicateVehicles: 10,
        },
      }),
    ).toThrow("25%");
    const conflict = parseMccauleyCurrent(
      mccauleyCurrentHtml().replace(
        "Vehicle 001 2003 Acura MDX",
        "Vehicle 001 2003 Acura Forte",
      ),
    );
    expect(() => mccauleySnapshot(conflict, details())).toThrow("conflicting");
  });
});
