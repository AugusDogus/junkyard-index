import { createHash } from "node:crypto";
import { z } from "zod";
import type { Yard } from "~/lib/yard";
import {
  inventoryHtmlAttribute,
  stripInventoryRawText,
} from "./inventory-html";

export const BIGTRUCKPAGE_ORIGIN = "https://bigtruckpage.com";
export const BIGTRUCKPAGE_SELLER_PATH = "/sellers/misiuk-motors-llc";
export const BIGTRUCKPAGE_CATALOG_PATH =
  BIGTRUCKPAGE_SELLER_PATH + "/dismantling-trucks";
export const BIGTRUCKPAGE_CATALOG =
  BIGTRUCKPAGE_ORIGIN + BIGTRUCKPAGE_CATALOG_PATH;
export const bigtruckpageCatalogUrl = (page: number) =>
  page === 1 ? BIGTRUCKPAGE_CATALOG : `${BIGTRUCKPAGE_CATALOG}?page=${page}`;

// Native seller and donor pages establish the physical address and phone.
// The saved exact-name/address/phone Google Maps result supplies this point.
export const BIGTRUCKPAGE_YARD = {
  source: "bigtruckpage",
  code: "misiuk-motors-llc",
  name: "Misiuk Motors LLC",
  operator: "Misiuk Motors LLC",
  address: "101 E Monticello ST",
  city: "Strafford",
  state: "MO",
  postalCode: "65757",
  phone: "5037805340",
  email: null,
  lat: 37.2761689,
  lng: -93.1189117,
  websiteUrl: BIGTRUCKPAGE_ORIGIN + BIGTRUCKPAGE_SELLER_PATH,
} as const satisfies Yard;
export type BigtruckpageYard = typeof BIGTRUCKPAGE_YARD;

export const BigtruckpageProfileSchema = z
  .object({
    name: z.literal(BIGTRUCKPAGE_YARD.name),
    address: z.literal("101 E Monticello ST Strafford MO 65757"),
    phone: z.literal(BIGTRUCKPAGE_YARD.phone),
    catalogUrl: z.literal(BIGTRUCKPAGE_CATALOG),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

/** Verify native physical ownership before following this seller's catalog. */
export function parseBigtruckpageProfile(html: string) {
  const clean = stripInventoryRawText(html);
  if (Buffer.byteLength(html) > 4 * 1024 * 1024 || !/<\/html>\s*$/i.test(clean))
    throw new Error("BigTruckPage seller profile is oversized or truncated");
  const mains = [...clean.matchAll(/<main\b[^>]*>([\s\S]*?)<\/main>/gi)];
  const main = mains[0]?.[1] ?? "";
  const plain = (raw: string) =>
    raw
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const headings = [...main.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)];
  const phones = [
    ...main.matchAll(/<dt\b[^>]*>Phone<\/dt>\s*<dd\b[^>]*>([\s\S]*?)<\/dd>/gi),
  ];
  const addresses = [
    ...main.matchAll(
      /<dt\b[^>]*>Address<\/dt>\s*<dd\b[^>]*>([\s\S]*?)<\/dd>/gi,
    ),
  ];
  const phoneLinks = [
    ...(phones[0]?.[1] ?? "").matchAll(/(<a\b[^>]*>)([\s\S]*?)<\/a>/gi),
  ];
  const addressLinks = [
    ...(addresses[0]?.[1] ?? "").matchAll(/(<a\b[^>]*>)([\s\S]*?)<\/a>/gi),
  ].filter((match) =>
    inventoryHtmlAttribute(match[1] ?? "", "aria-label")?.startsWith(
      "Open directions to ",
    ),
  );
  const mobileAddresses = [
    ...(addresses[0]?.[1] ?? "").matchAll(
      /<span\b[^>]*class="text-white"[^>]*>([^<]*)<\/span>/gi,
    ),
  ];
  const catalogLinks = [
    ...main.matchAll(/(<a\b[^>]*>)([\s\S]*?)<\/a>/gi),
  ].filter(
    (match) =>
      inventoryHtmlAttribute(match[1] ?? "", "href") ===
      BIGTRUCKPAGE_CATALOG_PATH,
  );
  const phone = plain(phoneLinks[0]?.[2] ?? "").replace(/\D/g, "");
  const address = plain(addressLinks[0]?.[2] ?? "");
  if (
    mains.length !== 1 ||
    headings.length !== 1 ||
    phones.length !== 1 ||
    addresses.length !== 1 ||
    phoneLinks.length !== 1 ||
    addressLinks.length !== 1 ||
    mobileAddresses.length !== 1 ||
    plain(mobileAddresses[0]?.[1] ?? "") !== address ||
    !catalogLinks.length ||
    !/<p\b[^>]*>Strafford\s*,\s*MO<\/p>/.test(main) ||
    inventoryHtmlAttribute(phoneLinks[0]?.[1] ?? "", "href") !==
      "tel:+1" + phone ||
    inventoryHtmlAttribute(addressLinks[0]?.[1] ?? "", "aria-label") !==
      "Open directions to " + address + " in Google Maps"
  )
    throw new Error(
      "BigTruckPage seller physical identity is missing, conflicting or incomplete",
    );
  return BigtruckpageProfileSchema.parse({
    name: plain(headings[0]?.[1] ?? ""),
    address,
    phone,
    catalogUrl: BIGTRUCKPAGE_CATALOG,
    fingerprint: createHash("sha256").update(html).digest("hex"),
  });
}
