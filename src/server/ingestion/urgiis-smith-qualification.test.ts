import { expect, test } from "bun:test";
import { brotliDecompressSync } from "node:zlib";
import { z } from "zod";
import { URGIIS_TENANTS } from "./urgiis-configuration";
import { iisCards, iisDirectory, iisDocument } from "./urgiis-catalog";
import { iisAttribute, iisClass, iisElements, iisText } from "./iis-html";
import { inventoryVin } from "./inventory-vin";

const response = z.object({ url: z.string().url(), html: z.string() });
const proof = z
  .object({
    menu: response,
    model: response,
    revalidated: response,
    arrivals: response,
    detail: response,
  })
  .parse(
    JSON.parse(
      brotliDecompressSync(
        await Bun.file(
          new URL(
            "./urgiis-test-fixtures/smith-completeness.json.br",
            import.meta.url,
          ),
        ).bytes(),
      ).toString(),
    ),
  );
const site = {
  origin: "https://smithautone.com",
  urgid: "NE22",
  pathStyle: "parts",
} as const;

test("Smith remains excluded because its 30-card model page omits a separately verified own-yard donor", () => {
  expect(URGIIS_TENANTS.some((tenant) => tenant.origin === site.origin)).toBe(
    false,
  );
  const model = iisDirectory(proof.menu.html, site, {
    path: "/parts/FORD",
    label: "FORD",
    count: 0,
  }).find((control) => control.path === "/parts/FORD/FORD_F150_PICKUP/");
  expect(model?.count).toBe(163);
  const opening = iisCards(proof.model.html, site);
  const revalidated = iisCards(proof.revalidated.html, site);
  expect(opening.records).toHaveLength(30);
  expect(revalidated.hash).toBe(opening.hash);
  const arrival = iisCards(proof.arrivals.html, site, "arrivals").records.find(
    (record) => record.stock === "261352",
  );
  expect(arrival?.destinations).toEqual([proof.detail.url]);
  expect(arrival?.vins).toEqual(["1FTEW1EP9NKD56443"]);
  expect(inventoryVin("1FTEW1EP9NKD56443", "2022")).toBe("1FTEW1EP9NKD56443");
  expect(opening.records.some((record) => record.stock === "261352")).toBe(
    false,
  );

  const detail = iisDocument(proof.detail.html, site);
  const sellers = [...detail.matchAll(/<input\b[^>]*>/gi)].flatMap(([tag]) =>
    iisAttribute(tag, "name") === "sellingurgid"
      ? [iisAttribute(tag, "value")]
      : [],
  );
  expect(sellers.length).toBeGreaterThan(0);
  expect(sellers.every((seller) => seller === "NE22")).toBe(true);
  const vins = iisElements(detail, "li", (tag) =>
    iisClass(tag, "iispartpagevin"),
  ).map(({ body }) => iisText(body).replace(/^VIN:\s*/, ""));
  expect(vins.length).toBeGreaterThan(0);
  expect(vins.every((vin) => vin === "1FTEW1EP9NKD56443")).toBe(true);
});
