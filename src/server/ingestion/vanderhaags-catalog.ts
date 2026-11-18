import { VANDERHAAGS_YARDS } from "./vanderhaags-yards";
import { createHash } from "node:crypto";
import { iisAttribute, iisClass, iisElements, iisText } from "./iis-html";

export const VANDERHAAGS_ORIGIN = "https://www.vanderhaags.com";
export const VANDERHAAGS_CATALOG_PATH =
  "/New-Salvage.php?inventorytype=parts-unit&order=new-salvage&items=500";
export const VANDERHAAGS_PAGE_SIZE = 500;
export const VANDERHAAGS_MAX_PAGES = 20;

export interface VanderHaagsDonor {
  id: string;
  path: string;
  title: string;
  stock: string;
  yard: string;
  image: string | null;
}

export function vanderHaagsDocument(html: string) {
  if (html.length > 5_000_000 || !/<\/(?:html|body)>\s*$/i.test(html))
    throw new Error(
      "Vander Haags returned an oversized, challenged or truncated document",
    );
}

function textByClass(html: string, tag: string, name: string) {
  const nodes = iisElements(html, tag, (t) => iisClass(t, name));
  if (nodes.length !== 1) throw new Error("Expected one Vander Haags " + name);
  return iisText(nodes[0]?.body ?? "");
}

export function parseVanderHaagsPage(html: string, expectedPage: number) {
  vanderHaagsDocument(html);
  if (
    !/<input\b[^>]*id=["']selectedinventorytype["'][^>]*value=["']parts-unit["']/i.test(
      html,
    )
  )
    throw new Error("Vander Haags response is not the truck donor catalog");
  const footer = iisElements(
    html,
    "span",
    (t) => iisAttribute(t, "id") === "paginationfooter",
  );
  if (footer.length !== 1)
    throw new Error("Missing Vander Haags pagination census");
  const counts = new Set<number>();
  const pages: number[] = [];
  for (const a of iisElements(footer[0]?.body ?? "", "a")) {
    const href = iisAttribute(a.tag, "href");
    if (href === "#") continue;
    const url = href ? URL.parse(href, VANDERHAAGS_ORIGIN) : null;
    if (
      !url ||
      url.origin !== VANDERHAAGS_ORIGIN ||
      url.pathname !== "/New-Salvage.php" ||
      url.searchParams.get("inventorytype") !== "parts-unit" ||
      url.searchParams.get("order") !== "new-salvage" ||
      url.searchParams.get("items") !== "500"
    )
      throw new Error("Vander Haags pagination changed catalog scope");
    const count = Number(url.searchParams.get("recordcount"));
    const page = Number(url.searchParams.get("page"));
    if (
      !Number.isSafeInteger(count) ||
      count < 1 ||
      count > VANDERHAAGS_MAX_PAGES * VANDERHAAGS_PAGE_SIZE ||
      !Number.isSafeInteger(page) ||
      page < 1 ||
      iisText(a.body) !== String(page)
    )
      throw new Error("Invalid Vander Haags pagination counts");
    counts.add(count);
    pages.push(page);
  }
  const total = [...counts][0];
  const current = iisElements(footer[0]?.body ?? "", "li", (t) =>
    iisClass(t, "current"),
  );
  if (
    counts.size !== 1 ||
    total === undefined ||
    current.length !== 1 ||
    iisText(current[0]?.body ?? "") !== String(expectedPage) ||
    Math.max(...pages) !== Math.ceil(total / VANDERHAAGS_PAGE_SIZE)
  )
    throw new Error("Vander Haags pagination is inconsistent or repeated");
  const regions = iisElements(
    html,
    "span",
    (t) => iisAttribute(t, "id") === "results",
  );
  if (regions.length !== 1)
    throw new Error("Missing or repeated Vander Haags donor region");
  const results = regions[0]?.body ?? "";
  const donors = iisElements(results, "div", (t) =>
    iisClass(t, "item-card"),
  ).map((card): VanderHaagsDonor => {
    const id = iisAttribute(card.tag, "data-inventoryid");
    const path = iisAttribute(card.tag, "data-url");
    const title = textByClass(card.body, "h3", "item-title");
    const item = textByClass(card.body, "span", "item");
    const yard = textByClass(card.body, "span", "store");
    if (
      !id ||
      !/^[1-9]\d{0,9}$/.test(id) ||
      path !== "/detailview.php?part=" + id ||
      !/^\d{4} .+ Parts Unit: Truck (?:Dsl Sa|Dsl Ta|Gas)$/i.test(title) ||
      !/^Item:\S+$/.test(item) ||
      !/^.+, [A-Z]{2}$/.test(yard)
    )
      throw new Error("Malformed Vander Haags donor card");
    const imageTag = card.body.match(/<img\b[^>]*>/i)?.[0];
    const imageUrl = imageTag
      ? URL.parse(iisAttribute(imageTag, "src") ?? "")
      : null;
    const image =
      imageUrl?.origin === "https://pix.vanderhaags.com" &&
      !imageUrl.username &&
      !imageUrl.password
        ? imageUrl.href
        : null;
    return { id, path, title, stock: item.slice(5), yard, image };
  });
  if (
    donors.length !==
      Math.min(
        VANDERHAAGS_PAGE_SIZE,
        total - (expectedPage - 1) * VANDERHAAGS_PAGE_SIZE,
      ) ||
    new Set(donors.map((d) => d.id)).size !== donors.length
  )
    throw new Error("Vander Haags donor page is incomplete or duplicated");
  return { total, donors };
}

export const vanderHaagsCatalogHash = (donors: readonly VanderHaagsDonor[]) =>
  createHash("sha256")
    .update(
      JSON.stringify(
        donors.map(({ id, path, title, stock, yard }) => [
          id,
          path,
          title,
          stock,
          yard,
        ]),
      ),
    )
    .digest("hex");

export function parseVanderHaagsDetail(html: string, donor: VanderHaagsDonor) {
  vanderHaagsDocument(html);
  const heading = iisElements(
    html,
    "h1",
    (t) => iisAttribute(t, "id") === "topofpage",
  );
  const inventoryIds = [
    ...html.matchAll(/\bvar inventoryid\s*=\s*['"](\d+)['"]/g),
  ];
  if (
    heading.length !== 1 ||
    !/^\d{4} .+ Parts Unit: Truck (?:Dsl Sa|Dsl Ta|Gas)$/i.test(
      iisText(heading[0]?.body ?? ""),
    ) ||
    inventoryIds.length !== 1 ||
    inventoryIds[0]?.[1] !== donor.id
  )
    throw new Error("Vander Haags detail does not match the requested donor");
  const yard = VANDERHAAGS_YARDS.find((y) => y.catalogLabel === donor.yard);
  const locations = iisElements(html, "a", (t) =>
    (iisAttribute(t, "href") ?? "").startsWith("/locationtemplate.php?store="),
  );
  if (
    !yard ||
    !locations.some(
      (a) =>
        iisAttribute(a.tag, "href") ===
          "/locationtemplate.php?store=" + yard.store &&
        iisText(a.body) === donor.yard,
    )
  )
    throw new Error("Vander Haags donor location is unproven");
  const quantities = iisElements(
    html,
    "table",
    (t) => iisAttribute(t, "id") === "storequantity",
  );
  if (quantities.length !== 1)
    throw new Error("Missing or repeated Vander Haags quantity table");
  const quantity = iisText(quantities[0]?.body ?? "");
  const availability =
    quantity === "Location Quantity " + donor.yard + " 1"
      ? "available"
      : "unavailable";
  // A native empty quantity table (or explicit zero) is an individual unusable
  // listing. Never emit it, even though the catalog and location link agree.
  if (
    availability === "unavailable" &&
    quantity !== "Location Quantity" &&
    quantity !== "Location Quantity " + donor.yard + " 0"
  )
    throw new Error("Vander Haags donor quantity or yard attribution changed");
  const tables = iisElements(
    html,
    "table",
    (t) => iisAttribute(t, "id") === "specifications-table",
  );
  if (tables.length !== 1)
    throw new Error("Missing Vander Haags specifications");
  const fields = new Map<string, string>();
  // HTML permits an omitted </tr> before the next row. The native Price row
  // uses that syntax. Cells and the enclosing table must still be complete.
  for (const row of (tables[0]?.body ?? "").split(/<tr\b[^>]*>/i).slice(1)) {
    const cells = iisElements(row, "td").map((c) => iisText(c.body));
    const [key, value] = cells;
    if (cells.length !== 2 || !key || value === undefined || fields.has(key))
      throw new Error("Ambiguous Vander Haags specification row");
    fields.set(key, value);
  }
  if (fields.get("Item #:") !== donor.stock)
    throw new Error("Vander Haags detail stock disagrees with catalog");
  return { fields, availability } as const;
}
