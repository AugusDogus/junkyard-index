export const COUTU_ORIGIN = "https://www.truckcountry.us";
export const COUTU_HOME = COUTU_ORIGIN + "/";
export const COUTU_ROOT = COUTU_ORIGIN + "/browse";

export function coutuBrowsePath(raw: string, depth: 1 | 2): string | null {
  const url = URL.parse(raw, COUTU_ORIGIN);
  if (
    !url ||
    url.origin !== COUTU_ORIGIN ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !/^\/browse\/[a-z0-9-]+(?:\/[a-z0-9-]+)?$/.test(url.pathname) ||
    url.pathname.split("/").length !== depth + 2 ||
    url.pathname.startsWith("/browse/vehicle/")
  )
    return null;
  return url.pathname;
}

export function coutuDonorUrl(raw: string): string | null {
  const url = URL.parse(raw, COUTU_ORIGIN);
  return url &&
    url.origin === COUTU_ORIGIN &&
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash &&
    /^\/browse\/vehicle\/[A-Z0-9-]+$/i.test(url.pathname)
    ? url.href
    : null;
}

export function coutuImage(raw: string | null): string | null {
  const url = raw === null || raw.length > 1500 ? null : URL.parse(raw);
  return url &&
    url.href.length <= 1500 &&
    url.origin === "https://truckcountry.s3.amazonaws.com" &&
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash &&
    /^\/vehicle\/[\w-]+\.(?:jpe?g|png|webp)$/i.test(url.pathname)
    ? url.href
    : null;
}
