import type { Yard } from "~/lib/yard";
import {
  inventoryHtmlAttribute,
  stripInventoryRawText,
} from "./inventory-html";

export const PULLSAVEWA_YARDS = [
  {
    source: "pullsavewa",
    code: "mead",
    name: "Pull & Save Auto Parts, Mead",
    operator: "Pull & Save Auto Parts",
    address: "11125 N Market St",
    city: "Mead",
    state: "WA",
    postalCode: "99021",
    phone: "509-928-4000",
    email: null,
    // Saved exact-address directory JSON-LD matches the native home and sameAs.
    // The native map ll value is only an address-associated viewport center.
    lat: 47.758733,
    lng: -117.357121,
    websiteUrl: "http://www.pullandsave.com/north/home.htm",
    inventoryUrl:
      "https://newautopart.net/includes/pullandsave/mead/yard_locationslist.php",
  },
  {
    source: "pullsavewa",
    code: "spokane",
    name: "Pull & Save Auto Parts, Spokane Valley",
    operator: "Pull & Save Auto Parts",
    address: "10414 E Knox Ave",
    city: "Spokane Valley",
    state: "WA",
    postalCode: "99206",
    phone: "509-921-8000",
    email: null,
    // Saved directory JSON-LD matches the native Knox address and sameAs domain.
    // The native map's legacy University target does not establish another yard.
    lat: 47.676894,
    lng: -117.265031,
    websiteUrl: "http://www.pullandsave.com/home.htm",
    inventoryUrl:
      "https://newautopart.net/includes/pullandsave/spokane/yard_locationslist.php",
  },
] as const satisfies readonly (Yard & { inventoryUrl: string })[];
export type PullsavewaYard = (typeof PULLSAVEWA_YARDS)[number];

export function validatePullsavewaHome(
  html: string,
  yard: PullsavewaYard,
): void {
  if (!/<\/html>\s*$/i.test(html))
    throw new Error("Pull & Save home is truncated");
  const clean = stripInventoryRawText(html);
  const text = clean
    .replace(/<[^>]*>/g, " ")
    .replace(/&(?:amp|nbsp);/gi, " ")
    .replace(/[\s.-]/g, "")
    .toLowerCase();
  const address =
    yard.code === "mead" ? "11125nmarketstmead99021" : "10414eknoxspokane99206";
  const links = [...clean.matchAll(/<a\b[^>]*>/gi)].map(([tag]) =>
    inventoryHtmlAttribute(tag, "href"),
  );
  if (
    !text.includes(address) ||
    !text.includes(yard.phone.replaceAll("-", "")) ||
    !text.includes("completelyselfservice") ||
    !text.includes("vehiclestopullpartsfrom") ||
    !text.includes("newvehicleseveryweek") ||
    !links.includes(yard.inventoryUrl)
  )
    throw new Error(
      "Pull & Save physical ownership, self-service context or yard catalog routing changed",
    );
}
