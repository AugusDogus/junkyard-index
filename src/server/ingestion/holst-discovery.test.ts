import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { z } from "zod";
import { BIGTRUCKPAGE_YARD } from "./bigtruckpage-yard-metadata";
import { HTP_SUPPLIERS } from "./heavytruckparts-yard-metadata";
import { stripInventoryRawText } from "./inventory-html";
import { parseTruckPartsCatalogPage } from "./truck-parts-catalog";

const root = `${import.meta.dir}/holst-test-fixtures/discovery/`;
const receipts = z
  .array(
    z.object({
      url: z.string().url(),
      finalUrl: z.string().url(),
      file: z.string().regex(/^[a-z0-9-]+\.gz$/),
      status: z.number().int(),
      bytes: z.number().int().positive(),
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
      startedAt: z.string().datetime({ offset: true }),
      completedAt: z.string().datetime({ offset: true }),
      retryAfter: z.string().nullable(),
    }),
  )
  .length(16)
  .parse(JSON.parse(readFileSync(root + "requests.json", "utf8")));
const bodies = new Map(
  receipts.map((receipt) => [
    receipt.file,
    gunzipSync(readFileSync(root + receipt.file)),
  ]),
);
function body(file: string) {
  const bytes = bodies.get(file);
  if (!bytes) throw new Error("Missing Holst discovery fixture: " + file);
  return bytes.toString("utf8");
}

test("Holst discovery receipts preserve exact responses and polite serial spacing", () => {
  expect(new Set(receipts.map((receipt) => receipt.file)).size).toBe(16);
  expect(
    receipts.filter(
      (receipt) => new URL(receipt.url).host === "holsttruck.com",
    ),
  ).toHaveLength(10);
  for (const [index, receipt] of receipts.entries()) {
    const bytes = bodies.get(receipt.file);
    expect(bytes?.length).toBe(receipt.bytes);
    expect(createHash("sha256").update(body(receipt.file)).digest("hex")).toBe(
      receipt.sha256,
    );
    expect(receipt.finalUrl).toBe(receipt.url);
    expect(receipt.status).toBe(receipt.file === "tpi-home.gz" ? 403 : 200);
    expect(receipt.retryAfter).toBeNull();
    expect(Date.parse(receipt.completedAt)).toBeGreaterThanOrEqual(
      Date.parse(receipt.startedAt),
    );
    const previous = receipts[index - 1];
    if (previous)
      expect(
        Date.parse(receipt.startedAt) - Date.parse(previous.completedAt),
      ).toBeGreaterThanOrEqual(10_000);
  }
});

test("Holst's TPI portal ignores a larger page size and does not prove a full census", () => {
  const raw = body("page-size-100.gz");
  const html = stripInventoryRawText(raw);
  expect(raw).toContain("/wp-content/plugins/tpi-portal/");
  expect(raw).toContain("images.truckpartsinventory.com/trucks/22216/");
  expect(raw).not.toContain("hollanderstores.com");
  expect([...html.matchAll(/<div class='list-item'>/g)]).toHaveLength(25);
  expect([...html.matchAll(/>1-25 of 2374<\/span>/g)]).toHaveLength(2);
  expect(html).toContain("per_page=100&#038;page_number=95");
  expect([...html.matchAll(/id='page_(\d+)'/g)].map((m) => m[1])).toEqual([
    "10",
    "15",
    "25",
  ]);
  // An unsupported discovery query must not sneak past the native traversal guard.
  expect(() =>
    parseTruckPartsCatalogPage(raw, 1, {
      origin: "https://holsttruck.com",
      listPath: "/trucks/",
      detailPath: "/truck-description/",
      photoAccount: "22216",
    }),
  ).toThrow("pagination left");
  const identities = (raw: string) =>
    new Set([...raw.matchAll(/truck=(\d+)/g)].map((m) => m[1]));
  expect(identities(raw).size).toBe(25);
  expect(identities(body("trucks-newest.gz"))).toEqual(identities(raw));
  expect(body("native-detail.gz")).toContain("1GDE4C3206F434509");
});

test("alternate public channels supply no qualifying Holst donor census or ID credit", () => {
  const store = body("htp-holst.gz");
  expect(store).toContain("HOLST TRUCK PARTS");
  expect(store).toContain("10209 N YELLOWSTONE");
  expect(store).toContain("UCON, ID 83454");
  expect(store).toContain("fltpc=428606&store=1");
  expect(store).not.toMatch(/>Complete Vehicle - [\d,]+<\/a>/);
  expect(body("htp-holst-vehicles.gz")).toContain(
    "Sorry, no matches were found",
  );
  const directory = stripInventoryRawText(body("btp-sellers.gz"));
  const sellers = new Set(
    [...directory.matchAll(/href="(\/sellers\/[^"?]+)"/g)].map((m) => m[1]),
  );
  expect([...sellers].sort()).toEqual([
    "/sellers/central-motor-llc",
    "/sellers/complete-truck-repair",
    "/sellers/misiuk-motors-llc",
    "/sellers/route-66-trading-company",
  ]);
  expect(directory).toContain("4 sellers matched");
  expect(directory).toContain("Page 1/1");
  expect(body("robots.gz")).toContain(
    "Sitemap: https://holsttruck.com/wp-sitemap.xml",
  );
  expect([...body("sitemap.gz").matchAll(/<sitemap>/g)]).toHaveLength(1);
  expect([...body("pages-sitemap.gz").matchAll(/<url>/g)]).toHaveLength(18);
  expect(body("pages-sitemap.gz")).not.toContain("?truck=");
  expect(body("feed.gz")).toContain("<channel>");
  expect(body("feed.gz")).not.toMatch(/<item(?:\s|>)/);
  expect(HTP_SUPPLIERS.map((supplier) => supplier.yard.state)).not.toContain(
    "ID",
  );
  expect(BIGTRUCKPAGE_YARD.state).not.toBe("ID");
});

test("make-bucket carry-forward would still require 262 weekly reads before extras", () => {
  const makes = [
    ...body("page-size-100.gz").matchAll(
      /f-make=(\d+)'>\s*([^<]+?)\s*<div class='btn-count text-white'>\s*(\d+)<\/div>/g,
    ),
  ].map((match) => ({ id: match[1], count: Number(match[3]) }));
  expect(makes).toHaveLength(39);
  expect(new Set(makes.map((make) => make.id)).size).toBe(39);
  const total = makes.reduce((sum, make) => sum + make.count, 0);
  const pages = makes.map((make) => Math.ceil(make.count / 25));
  expect(total).toBe(2374);
  expect(2 * Math.ceil(total / 25)).toBe(190);
  expect(pages.reduce((sum, count) => sum + count, 0)).toBe(124);
  const days = Array.from({ length: 7 }, () => 0);
  for (const count of pages.sort((a, b) => b - a)) {
    const index = days.indexOf(Math.min(...days));
    days[index] = (days[index] ?? 0) + 2 * count;
  }
  const withControls = days.map((count) => count + 2);
  expect(withControls).toEqual([38, 38, 38, 38, 38, 36, 36]);
  expect(withControls.reduce((sum, count) => sum + count, 0)).toBe(262);
});
