import type { Yard } from "~/lib/yard";
import { stripInventoryRawText } from "./inventory-html";

export const AERO_ORIGIN = "https://aeroautosalvage.com";
export const AERO_INVENTORY_URL = AERO_ORIGIN + "/vehicle-inventory/";
// Official contact details and linked business pin verified 2026-11-11.
// Former names are aliases of this single yard. See the Aero runbook.
export const AERO_YARD = {
  source: "aero",
  code: "shreveport",
  name: "Aero Auto Parts",
  operator: "Aero Auto Parts LLC",
  address: "707 Aero Drive",
  city: "Shreveport",
  state: "LA",
  postalCode: "71107",
  phone: "318-227-1010",
  email: null,
  lat: 32.528713,
  lng: -93.7699419,
  websiteUrl: AERO_INVENTORY_URL,
} as const satisfies Yard;

export function parseAeroYard(
  home: string,
  directions: string,
): typeof AERO_YARD {
  if (
    ![home, directions].every(
      (html) => html.length < 2_000_000 && /<\/html>\s*$/i.test(html),
    )
  )
    throw new Error("Official Aero contact page is oversized or truncated");
  const plain = (html: string) =>
    stripInventoryRawText(html)
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ");
  const contact = plain(home);
  const address = plain(directions);
  if (
    !contact.includes("Aero Auto Parts LLC is not affiliated with UAPI") ||
    !contact.includes("standalone location") ||
    !contact.includes(AERO_YARD.phone) ||
    !address.includes(
      "Aero Auto Salvage is located at 707 Aero Drive, Shreveport LA 71107",
    ) ||
    !directions.includes("https://maps.app.goo.gl/6znwuqWSmu21Fy1YA")
  )
    throw new Error(
      "Official Aero contact identity changed; inspect the official site before retrying",
    );
  return AERO_YARD;
}
