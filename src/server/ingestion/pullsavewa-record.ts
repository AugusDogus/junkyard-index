import type { PullsavewaYard } from "./pullsavewa-yard-metadata";

export interface PullsavewaRecord {
  stock: string;
  row: string;
  date: string;
  vin: string;
  year: string;
  make: string;
  model: string;
  detailsUrl: string;
  nativeImageUrl: string | null;
}

function missingDescription(value: string): boolean {
  return (
    /^(?:|other|unknown|none|null|na|0+)$/.test(
      value.toLowerCase().replace(/[\s/_.-]+/g, ""),
    ) || !/[A-Z0-9]/i.test(value)
  );
}

function stockNumber(raw: string): string | null {
  return !missingDescription(raw) && /^[A-Z0-9]{1,30}$/i.test(raw) ? raw : null;
}

function photoUrl(
  record: PullsavewaRecord,
  yard: PullsavewaYard,
): string | null {
  if (record.nativeImageUrl === null) return null;
  const photo = URL.parse(record.nativeImageUrl);
  const detail = URL.parse(record.detailsUrl);
  const stock = stockNumber(record.stock);
  const nativeStock = detail?.searchParams.get("Stock_Ticket");
  // The enclosing native image anchor binds the photo to the donor. Numeric
  // photo filenames never supply a missing stock number or other metadata.
  return photo &&
    photo.href === record.nativeImageUrl &&
    photo.origin === "https://newautopart.net" &&
    !photo.username &&
    !photo.password &&
    !photo.search &&
    !photo.hash &&
    new RegExp(
      `^/includes/pullandsave/${yard.code}_photos/[1-9]\\d{0,11}_01\\.jpg$`,
    ).test(photo.pathname) &&
    detail?.origin === photo.origin &&
    detail.pathname ===
      `/includes/pullandsave/${yard.code}/yard_locationsview.php` &&
    !detail.username &&
    !detail.password &&
    !detail.hash &&
    [...detail.searchParams].length === 2 &&
    detail.searchParams.get("showdetail") === "" &&
    nativeStock &&
    /^[A-Z0-9]{1,30}$/i.test(nativeStock) &&
    (stock === null || stock === nativeStock)
    ? photo.href
    : null;
}

export const PullsavewaRecord = {
  missingDescription,
  stockNumber,
  photoUrl,
} as const;
