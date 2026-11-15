import type { Yard } from "~/lib/yard";

export const SCOTTS_ORIGIN = "https://hondapartsused.com";
export const SCOTTS_ROOT = SCOTTS_ORIGIN + "/";
export const SCOTTS_MAKES = SCOTTS_ORIGIN + "/used-parts/makes/";
export const SCOTTS_IMAGE_PREFIX =
  "https://da8h1v3w8q6n5.cloudfront.net/cc68/images/";

// Native contact footer and its published maps.app.goo.gl/pZkF3dTkXjtEwNtV7
// redirect bind this named-business point, not a map viewport, to the yard.
export const SCOTTS_YARD = {
  source: "scotts",
  code: "fort-collins",
  name: "Scott's Used Parts",
  operator: "Scott's Used Parts",
  address: "938 West Willox Lane",
  city: "Fort Collins",
  state: "CO",
  postalCode: "80524",
  phone: "970-498-0662",
  email: "sales@hondapartsused.com",
  lat: 40.5885034,
  lng: -105.0490494,
  websiteUrl: SCOTTS_ROOT,
} as const satisfies Omit<Yard, "source"> & { source: "scotts" };
export type ScottsYard = typeof SCOTTS_YARD;

/** Validate literal controls without constructing or decoding native routes. */
export function scottsBrowsePath(raw: string, depth: 1 | 2): string | null {
  const url = URL.parse(raw, SCOTTS_ORIGIN);
  if (
    !url ||
    url.origin !== SCOTTS_ORIGIN ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !/^\/used-parts\/[^/]+(?:\/[^/]+)?\/?$/.test(url.pathname) ||
    url.pathname.split("/").filter(Boolean).length !== depth + 1
  )
    return null;
  return url.pathname;
}
