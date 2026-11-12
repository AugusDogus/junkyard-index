import { FENIX_ORIGIN } from "./fenix-yard-metadata";

/** Preserve the published URL, including its actual thumbnail dimensions. */
export function fenixPhotoUrl(raw: string | null, id: string): string | null {
  if (!raw || raw.length > 4096 || !/^\d{1,20}$/.test(id)) return null;
  const url = URL.parse(raw, FENIX_ORIGIN);
  if (
    !url ||
    url.origin !== FENIX_ORIGIN ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !new RegExp(
      `^/wp-content/uploads/20\\d{2}/(?:0[1-9]|1[0-2])/${id}_[1-9]\\d*(?:-\\d+)*(?:-\\d+x\\d+)?\\.(?:jpe?g|png|webp)$`,
      "i",
    ).test(url.pathname)
  )
    return null;
  return url.href;
}
