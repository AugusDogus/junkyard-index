import type { Yard } from "~/lib/yard";

export const CENTRAL_ORIGIN = "https://centralautoliq.com";
export const CENTRAL_ROOT = CENTRAL_ORIGIN + "/";
export const CENTRAL_MAKES = CENTRAL_ORIGIN + "/used-parts/";
export const CENTRAL_IMAGE_PREFIX =
  "https://da8h1v3w8q6n5.cloudfront.net/dd15/images/";

// Saved named-business ASYD point, accuracy unstated. The exact native business
// name/address and saved directory slug bind it to this physical yard.
export const CENTRAL_YARD = {
  source: "central",
  code: "franklin",
  name: "Central Auto Liquidators",
  operator: "Central Auto Liquidators",
  address: "245 Davis Road",
  city: "Franklin",
  state: "NJ",
  postalCode: "07416",
  phone: "973-827-3696",
  email: null,
  lat: 41.1073,
  lng: -74.61807,
  websiteUrl: CENTRAL_ROOT,
} as const satisfies Omit<Yard, "source"> & { source: "central" };
export type CentralYard = typeof CENTRAL_YARD;

/** Validate literal controls without constructing or decoding native routes. */
export function centralBrowsePath(raw: string, depth: 1 | 2): string | null {
  const url = URL.parse(raw, CENTRAL_ORIGIN);
  if (
    !url ||
    url.origin !== CENTRAL_ORIGIN ||
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
