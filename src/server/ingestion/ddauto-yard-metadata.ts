import { z } from "zod";
import type { Yard } from "~/lib/yard";
import {
  inventoryHtmlAttribute,
  stripInventoryRawText,
} from "./inventory-html";

export const DDAUTO_ORIGIN = "https://www.ddautoandsalvage.com";
export const DDAUTO_OWNER_URL = DDAUTO_ORIGIN + "/self-service-parts-yard";
export const DDAUTO_APP_ORIGIN = "https://dd-auto-parts-cars.glide.page";
export const DDAUTO_INVENTORY_URL = DDAUTO_APP_ORIGIN + "/dl/17171d";
export const DDAUTO_APP_ID = "Ws6yVYonyVyaoiyrIvyP";
export const DDAUTO_TABLE_ID = "hCt5Yx92WXW37h62Gc99";
export const DDAUTO_TABLE = "native-table-" + DDAUTO_TABLE_ID;
export const DDAUTO_DOCUMENT_ROOT =
  "projects/glide-prod/databases/(default)/documents/glide-apps-v4-data/" +
  DDAUTO_APP_ID +
  "/tables/_" +
  DDAUTO_TABLE;
export const DDAUTO_QUERY_URL =
  "https://firestore.googleapis.com/v1/" + DDAUTO_DOCUMENT_ROOT + ":runQuery";

// Address and coordinates are published together in the official Wix SEO context.
export const DDAUTO_YARD = {
  source: "ddauto",
  code: "logan",
  name: "DD Auto & Salvage",
  operator: "DD Auto & Salvage",
  address: "1976 West 200 North",
  city: "Logan",
  state: "UT",
  postalCode: "84321",
  phone: "435-787-1204",
  email: "ddauto2007@gmail.com",
  lat: 41.7355957,
  lng: -111.8810324,
  websiteUrl: DDAUTO_OWNER_URL,
} as const satisfies Yard;
export type DdautoYard = typeof DDAUTO_YARD;

export function parseDdautoYard(raw: string): DdautoYard {
  if (!/<\/html>\s*$/i.test(raw))
    throw new Error("DD Auto official owner page is truncated");
  const scripts = [
    ...raw.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi),
  ].filter(
    (m) => inventoryHtmlAttribute(m[1] ?? "", "id") === "wix-viewer-model",
  );
  if (scripts.length !== 1)
    throw new Error(
      "DD Auto official location metadata is missing or ambiguous",
    );
  z.object({
    siteFeaturesConfigs: z.object({
      seo: z.object({
        context: z.object({
          businesLocationsDescription: z.literal(
            "1976 W 200 N, Logan, UT 84321, USA",
          ),
          businessLocationCoordinates: z.object({
            latitude: z.literal(DDAUTO_YARD.lat),
            longitude: z.literal(DDAUTO_YARD.lng),
          }),
        }),
      }),
    }),
  }).parse(JSON.parse(scripts[0]?.[2] ?? ""));
  const body = stripInventoryRawText(raw);
  const plain = body
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
  const links = [...body.matchAll(/<a\b[^>]*>/gi)];
  if (
    !plain.includes("DD Auto & Salvage") ||
    !plain.includes("1976 West 200 North, Logan UT 84321") ||
    !plain.includes("(435) 787-1204") ||
    !plain.includes("current and upcoming parts cars inventory") ||
    !links.some(
      ([tag]) => inventoryHtmlAttribute(tag, "href") === DDAUTO_APP_ORIGIN,
    )
  )
    throw new Error(
      "DD Auto physical owner or native inventory destination changed",
    );
  return DDAUTO_YARD;
}
