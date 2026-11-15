import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { parsePickNSaveDetail } from "./picknsave-parser";

const fixture = await Bun.file(
  new URL("./fixtures/picknsave-detail.html", import.meta.url),
).text();
const product = {
  id: 4960,
  date: "2026-08-03T00:00:00",
  status: "publish" as const,
  type: "product" as const,
  link: "https://pick-n-save.net/vehicles/2009-hyundai-genesis-sler2663/",
};
const parse = (html = fixture) =>
  Effect.runPromise(parsePickNSaveDetail(html, product));

describe("Pick-n-Save field quality", () => {
  test("accepts a valid donor without the optional metadata headings or photo", async () => {
    let html = fixture;
    for (const field of ["Color", "Stock", "Location"]) {
      html = html.replace(
        new RegExp(
          `<(div|h1)\\b[^>]*class="[^"]*elementor-heading-title[^"]*"[^>]*><b>${field}:</b>[^<]*</\\1>`,
        ),
        "",
      );
    }
    const result = await Effect.runPromise(
      parsePickNSaveDetail(html, { ...product, date: "invalid" }),
    );
    expect(result).toMatchObject({
      status: "available",
      record: {
        vin: "KMHGC46E69U039032",
        year: 2009,
        make: "Hyundai",
        model: "GENESIS",
        color: null,
        stockNumber: null,
        row: null,
        availableDate: null,
        imageUrl: null,
      },
    });
  });
  test("joins observed product identity to complete vehicle fields and its actual photo", async () => {
    expect(await parse()).toMatchObject({
      status: "available",
      record: {
        vin: "KMHGC46E69U039032",
        year: 2009,
        make: "Hyundai",
        model: "GENESIS",
        stockNumber: "SLER2663",
        color: "Black",
        row: "UIL10",
        yardCode: "PNS-VA-LYNCHBURG",
        availableDate: "2026-08-03T00:00:00.000Z",
        detailsUrl: product.link,
        imageUrl:
          "https://cunninghambros.s3.us-east-1.amazonaws.com/images/SLER2663/1dd41059-6d89-491a-b5fe-81879b2b58de.jpg",
      },
    });
  });
  test.each(["Make", "Model"])(
    "does not emit a vehicle with an empty %s",
    async (field) => {
      const result = await parse(
        fixture.replace(new RegExp(`(<b>${field}:</b>)[^<]*`), "$1"),
      );
      expect(result).toMatchObject({
        status: "incomplete",
        vin: "KMHGC46E69U039032",
      });
    },
  );
  test("keeps an explicit unknown color null", async () => {
    expect(await parse(fixture.replace("[BLACK]", "[UNKNOWN]"))).toMatchObject({
      status: "available",
      record: { color: null },
    });
  });
  test("rejects a source record whose empty make suppresses its heading", async () => {
    const html = fixture.replace(
      /<(div|h1)\b[^>]*class="[^"]*elementor-heading-title[^"]*"[^>]*><b>Make:<\/b>[^<]*<\/\1>/,
      "",
    );
    expect(html).not.toContain("<b>Make:</b>");
    expect(await parse(html)).toMatchObject({
      status: "incomplete",
      vin: "KMHGC46E69U039032",
    });
  });
  test("rejects invalid modern VINs and retains unpadded pre-1981 identifiers", async () => {
    expect(
      await parse(fixture.replace("KMHGC46E69U039032", "BAD-VIN")),
    ).toMatchObject({ status: "incomplete", vin: null });
    expect(
      await parse(
        fixture
          .replace("<b>Year:</b> 2009", "<b>Year:</b> 1977")
          .replace("KMHGC46E69U039032", "F10GNX12345"),
      ),
    ).toMatchObject({
      status: "available",
      record: { vin: "F10GNX12345", year: 1977 },
    });
  });
  test("does not substitute a logo or another stock's photo", async () => {
    const html = fixture.replaceAll(
      "/images/SLER2663/",
      "/images/OTHER-STOCK/",
    );
    expect(await parse(html)).toMatchObject({
      status: "available",
      record: { imageUrl: null },
    });
  });
  test("uses the explicit out-of-stock state without preserving presence", async () => {
    expect(await parse(fixture.replace(" instock ", " outofstock "))).toEqual({
      status: "unavailable",
    });
  });
  test.each([
    ["truncated response", (s: string) => s.replace("</html>", "")],
    ["wrong product", (s: string) => s.replace("post-4960", "post-5000")],
    [
      "missing field contract",
      (s: string) => s.replace("<b>VIN:</b>", "<b>Identifier:</b>"),
    ],
    [
      "duplicate field",
      (s: string) =>
        s.replace(
          "</body>",
          '<div class="elementor-heading-title"><b>VIN:</b> OTHER</div></body>',
        ),
    ],
    [
      "unknown yard",
      (s: string) => s.replace(">Lynchburg</div>", ">Unknown Yard</div>"),
    ],
  ] as const)("fails closed on %s", async (_name, mutate) => {
    await expect(parse(mutate(fixture))).rejects.toThrow();
  });
  test("keeps an invalid source inventory date null instead of inventing one", async () => {
    const result = await Effect.runPromise(
      parsePickNSaveDetail(fixture, {
        ...product,
        date: "2026-02-30T00:00:00",
      }),
    );
    expect(result).toMatchObject({
      status: "available",
      record: { availableDate: null },
    });
  });
  test("accepts a missing provider inventory date without a substitute", async () => {
    const result = await Effect.runPromise(
      parsePickNSaveDetail(fixture, { ...product, date: undefined }),
    );
    expect(result).toMatchObject({
      status: "available",
      record: { availableDate: null },
    });
  });
});
