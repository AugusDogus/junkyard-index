/** Validate provider-published photos without making enrichment requests. */
export function vehiclePhoto(
  raw: unknown,
  host: string,
  path: RegExp,
): string | null {
  if (typeof raw !== "string") return null;
  const url = URL.parse(raw);
  return url &&
    url.protocol === "https:" &&
    url.host === host &&
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash &&
    !/(?:placeholder|no[-_ ]?(?:image|photo)|coming[-_ ]?soon|logo)/i.test(
      url.pathname,
    ) &&
    path.test(url.pathname)
    ? url.href
    : null;
}

export function hollanderVehiclePhoto(raw: unknown): string | null {
  return vehiclePhoto(
    raw,
    "d1vnbry5hm94g5.cloudfront.net",
    /^\/(?:[A-Z0-9]+\/){4}[A-Z0-9]+(?:-T)?\.jpg$/,
  );
}

export function midwayVehiclePhoto(raw: unknown): string | null {
  return vehiclePhoto(
    raw,
    "da8h1v3w8q6n5.cloudfront.net",
    /^\/(?:mo06|oo95)\/images\/[^/]+\/[^/]+\.jpe?g$/i,
  );
}

export function northwestVehiclePhoto(raw: unknown): string | null {
  return vehiclePhoto(
    raw,
    "da8h1v3w8q6n5.cloudfront.net",
    /^\/ak01\/images\/[^/]+\/[^/]+\.jpe?g$/i,
  );
}

/** The search API names a stock's photo before the yard uploads it, so a new
 * arrival's URL can 404 for about a week; the page falls back to its placeholder. */
export function usAutoSupplyVehiclePhoto(
  raw: unknown,
  stock: string,
): string | null {
  const photo = vehiclePhoto(
    raw,
    "usautosupplymi.com",
    /^\/inventory-photos\/STK\d{6}\.jpg$/,
  );
  return photo === `https://usautosupplymi.com/inventory-photos/${stock}.jpg`
    ? photo
    : null;
}

export function tritownVehiclePhoto(raw: unknown): string | null {
  return vehiclePhoto(
    raw,
    "tritownautosalvage.com",
    /^\/wp-content\/uploads\/\d{4}\/\d{2}\/[^/]+\.(?:jpe?g|png|webp)$/i,
  );
}

export function alsautoVehiclePhoto(raw: unknown): string | null {
  return vehiclePhoto(
    raw,
    "cs.copart.com",
    /^\/v1\/AUTH_svc\.pdoc\d+\/lpp\/\d{4}\/[a-f0-9]+_thb\.jpg$/i,
  );
}
