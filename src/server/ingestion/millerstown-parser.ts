import {
  inventoryHtmlAttribute,
  stripInventoryRawText,
} from "./inventory-html";
import {
  MILLERSTOWN_INVENTORY_URL,
  MILLERSTOWN_ORIGIN,
  MILLERSTOWN_ROOT_URL,
} from "./millerstown-yard-metadata";

const plain = (html: string) =>
  html
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const attributeText = (text: string) =>
  text.replace(/&amp;|&#0*38;|&#x0*26;/gi, "&");
function requirePage(condition: boolean, reason: string): asserts condition {
  if (!condition) throw new Error(`Millerstown native page: ${reason}`);
}
function element(clean: string, id: string) {
  // A footer widget nests a div of the same type. Find its opening independently
  // so an outer containing div cannot consume it in a global match.
  const openings = [...clean.matchAll(/<(?:div|h1)\b[^>]*>/gi)].filter(
    ([tag]) => inventoryHtmlAttribute(tag, "id") === id,
  );
  requirePage(openings.length === 1, `expected one ${id} ownership element`);
  const opening = openings[0];
  requirePage(opening !== undefined, `missing ${id}`);
  const rest = clean.slice(opening.index + opening[0].length);
  const closing = /<\/(?:div|h1)\s*>/i.exec(rest);
  requirePage(closing !== null, `unclosed ${id} ownership element`);
  return plain(rest.slice(0, closing.index));
}
function owner(html: string, url: string) {
  const clean = stripInventoryRawText(html);
  requirePage(
    html.length <= 4 * 1024 * 1024 && /<\/html>\s*$/i.test(clean),
    "oversized or incomplete HTML",
  );
  const name = element(clean, "site_title");
  const address = element(clean, "text-4");
  const contact = element(clean, "text-5");
  requirePage(
    name === "Millerstown Pic-A-Part Yard" &&
      address === "Location: 3148 Lardintown Road Tarentum, PA 15084" &&
      contact === "Contact Us: Tel: 724-224-4777 Fax: 724-224-4154",
    "operator, physical address or native phone changed",
  );
  const canonical = [...clean.matchAll(/<link\b[^>]*>/gi)].filter(
    ([tag]) => inventoryHtmlAttribute(tag, "rel") === "canonical",
  );
  requirePage(
    canonical.length === 1 &&
      inventoryHtmlAttribute(canonical[0]?.[0] ?? "", "href") === url,
    "canonical page is missing, changed or filtered",
  );
  return { clean, proof: { name, address, contact } };
}

export function millerstownPdfUrl(href: string): string {
  const url = URL.parse(attributeText(href), MILLERSTOWN_INVENTORY_URL);
  requirePage(
    url !== null &&
      url.origin === MILLERSTOWN_ORIGIN &&
      url.pathname.startsWith("/wp-content/uploads/") &&
      url.pathname.toLowerCase().endsWith(".pdf") &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash,
    "published PDF must be a direct native upload URL without credentials, filters or fragments",
  );
  return url.href;
}

export function parseMillerstownRoot(html: string) {
  const { clean, proof } = owner(html, MILLERSTOWN_ROOT_URL);
  requirePage(
    plain(clean).includes("We are a self-service salvage yard"),
    "native self-service scope changed",
  );
  const links = [...clean.matchAll(/<a\b[^>]*>/gi)].map(([tag]) =>
    inventoryHtmlAttribute(tag, "href"),
  );
  requirePage(
    links.some(
      (href) =>
        href !== null &&
        URL.parse(attributeText(href), MILLERSTOWN_ROOT_URL)?.href ===
          MILLERSTOWN_INVENTORY_URL,
    ),
    "native inventory link is missing",
  );
  return proof;
}

export function parseMillerstownInventory(html: string) {
  const { clean, proof } = owner(html, MILLERSTOWN_INVENTORY_URL);
  const titles = [...clean.matchAll(/<title\b[^>]*>([\s\S]*?)<\/title>/gi)];
  const headings = [...clean.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)];
  requirePage(
    titles.length === 1 &&
      plain(titles[0]?.[1] ?? "") === "Vehicles on Premises" &&
      headings.length === 1 &&
      plain(headings[0]?.[1] ?? "") === "Vehicles on Premises",
    "complete Vehicles on Premises scope changed",
  );
  const links = [...clean.matchAll(/<a\b[^>]*>/gi)].flatMap(([tag]) => {
    const href = inventoryHtmlAttribute(tag, "href");
    return href !== null && /\.pdf(?:[?#]|$)/i.test(attributeText(href))
      ? [millerstownPdfUrl(href)]
      : [];
  });
  requirePage(
    links.length === 1 && links[0] !== undefined,
    "expected exactly one published PDF link",
  );
  const pdfUrl = links[0];
  const frames = [...clean.matchAll(/<iframe\b[^>]*>/gi)];
  const source = inventoryHtmlAttribute(frames[0]?.[0] ?? "", "src");
  const viewer =
    source === null
      ? null
      : URL.parse(attributeText(source), MILLERSTOWN_INVENTORY_URL);
  requirePage(
    frames.length === 1 &&
      viewer !== null &&
      viewer.hostname === "docs.google.com" &&
      viewer.pathname === "/viewer" &&
      !viewer.username &&
      !viewer.password &&
      viewer.searchParams.getAll("url").length === 1 &&
      viewer.searchParams.get("url") === pdfUrl,
    "embedded viewer differs from the published native PDF",
  );
  return { pdfUrl, proof: { ...proof, title: "Vehicles on Premises" } };
}
