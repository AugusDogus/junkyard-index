import { stripInventoryRawText } from "./inventory-html";
export function shopifyYardDocument(raw: string) {
  const html = stripInventoryRawText(raw);
  if (
    Buffer.byteLength(raw) > 4 * 1024 * 1024 ||
    !/<html\b/i.test(html) ||
    !/<body\b/i.test(html) ||
    !/<\/body\s*>\s*<\/html\s*>\s*$/i.test(html)
  )
    throw new Error("Owned Shopify HTML is oversized or incomplete");
  return html;
}

export function shopifyYardImage(
  raw: string | null,
  hosts: readonly string[],
): string | null {
  const url = raw
    ? URL.parse(raw.startsWith("//") ? "https:" + raw : raw)
    : null;
  return url &&
    url.protocol === "https:" &&
    !url.username &&
    !url.password &&
    hosts.includes(url.hostname)
    ? url.href
    : null;
}
