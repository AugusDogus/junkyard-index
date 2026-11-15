import { describe, expect, test } from "bun:test";
import { KandrNative } from "./kandr-native";
import { kandrFixture } from "./kandr-test-fixtures";

describe("K&R native donor boundaries", () => {
  test("discovers the two donor categories separately from retail vehicles", () => {
    expect(
      KandrNative.controls(kandrFixture.controls.html).map((url) =>
        new URL(url).searchParams.get("part_type"),
      ),
    ).toEqual(["99994", "99992"]);
  });
  test("enumerates the actual 3+25+21 cards and closes their literal pagination", () => {
    const pages = kandrFixture.opening.map((r) =>
      KandrNative.listing(r.html, r.url),
    );
    expect(pages.map((p) => p.cards.length)).toEqual([3, 25, 21]);
    expect(pages.map((p) => p.total)).toEqual([3, 46, 46]);
    expect(pages.map((p) => p.nextUrl)).toEqual([
      null,
      kandrFixture.opening[2]?.url ?? null,
      null,
    ]);
    expect(new Set(pages.flatMap((p) => p.cards.map((c) => c.id))).size).toBe(
      49,
    );
  });
  test("retains literal full identity and the component-only scope contradiction", () => {
    const records = kandrFixture.details.map((r) =>
      KandrNative.detail(r.html, r.url),
    );
    expect(records[0]?.fields.VIN).toEqual(["4V4NC9EG1CN543067"]);
    expect(
      records.find((r) => r.id === "6483483/1/81643")?.descriptions,
    ).toEqual(["Used refrigerator cabinet"]);
  });
  test("rejects foreign suppliers, filters, repeated query keys and truncated pages", () => {
    const native = kandrFixture.opening[0];
    if (!native) throw new Error("Missing real K&R fixture");
    expect(() =>
      KandrNative.listing(
        native.html.replaceAll("6483483", "9999999"),
        native.url,
      ),
    ).toThrow();
    expect(() =>
      KandrNative.listing(
        native.html,
        native.url.replace("keywords=", "keywords=volvo"),
      ),
    ).toThrow();
    expect(() =>
      KandrNative.listing(native.html, native.url + "&part_type=99994"),
    ).toThrow();
    expect(() =>
      KandrNative.listing(native.html.slice(0, -100), native.url),
    ).toThrow();
  });
});
