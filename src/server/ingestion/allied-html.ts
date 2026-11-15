import { stripInventoryRawText } from "./inventory-html";

export const ALLIED_ORIGIN = "https://alliedautowrecking.com";
export const ALLIED_MAKES = ALLIED_ORIGIN + "/parts/";
export const ALLIED_ARRIVALS = ALLIED_ORIGIN + "/latest-arrivals/";
export const ALLIED_IMAGE_PREFIX =
  "https://da8h1v3w8q6n5.cloudfront.net/kk25/images/";

export {
  iisText as alliedText,
  iisAttribute as alliedAttribute,
  iisClass as alliedClass,
  iisElements as alliedElements,
  iisRegion as alliedRegion,
  iisRouteLabel as alliedRouteLabel,
  iisContinuation as alliedContinuation,
} from "./iis-html";
export function alliedDocument(raw: string): string {
  const html = stripInventoryRawText(raw);
  if (
    Buffer.byteLength(raw) > 2 * 1024 * 1024 ||
    [/<html\b/gi, /<body\b/gi, /<\/body\s*>/gi, /<\/html\s*>/gi].some(
      (pattern) => [...html.matchAll(pattern)].length !== 1,
    ) ||
    !/<\/body\s*>\s*<\/html\s*>\s*$/i.test(html)
  )
    throw new Error("Native response is oversized or truncated");
  const suppliers = [...raw.matchAll(/\bvar\s+urgid\s*=\s*(['"])(.*?)\1\s*;/g)];
  if (!suppliers.length || suppliers.some((match) => match[2] !== "KK25"))
    throw new Error("Native KK25 supplier is missing or conflicting");
  return html;
}
export function alliedOwnedUrl(raw: string, base = ALLIED_ORIGIN): URL | null {
  const url = URL.parse(raw, base);
  return url &&
    url.origin === ALLIED_ORIGIN &&
    !url.username &&
    !url.password &&
    !url.hash
    ? url
    : null;
}
export function alliedBrowsePath(raw: string, depth: 1 | 2): string | null {
  const url = alliedOwnedUrl(raw);
  return url &&
    !url.search &&
    /^\/parts\/[^/]+(?:\/[^/]+)?\/?$/.test(url.pathname) &&
    url.pathname.split("/").filter(Boolean).length === depth + 1 &&
    url.pathname.replace(/\/$/, "") !== "/parts/makes"
    ? url.pathname
    : null;
}
