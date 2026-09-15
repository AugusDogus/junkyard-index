/** Strict structural primitives for complete, server-rendered inventory tables.
 * These intentionally reject malformed markup rather than repairing a partial catalog.
 */
export function stripInventoryRawText(html: string): string {
  const clean = html.replace(
    /<!--[\s\S]*?-->|<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,
    "",
  );
  if (/<!--|<(?:script|style)\b/i.test(clean))
    throw new Error("Unclosed inventory comment or raw-text element");
  return clean;
}

/** Exact attribute names, including boolean attributes. Values remain encoded. */
export function inventoryHtmlAttribute(
  tag: string,
  name: string,
): string | null {
  const attributes = [
    ...tag.matchAll(
      /([^\s=<>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g,
    ),
  ].filter((match) => match[1]?.toLowerCase() === name);
  if (attributes.length > 1)
    throw new Error(`Duplicate inventory HTML attribute ${name}`);
  const match = attributes[0];
  return match ? (match[2] ?? match[3] ?? match[4] ?? "") : null;
}

export function inventoryTableSections(table: string): {
  head: string;
  body: string;
} {
  if (/<table\b/i.test(table)) throw new Error("Nested inventory table");
  const outside = table.replace(
    /<(thead|tbody)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,
    "",
  );
  if (/<\/?(?:tr|td|th)\b/i.test(outside))
    throw new Error("Inventory cells outside the header/body contract");
  const section = (name: "thead" | "tbody") => {
    const matches = [
      ...table.matchAll(
        new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}\\s*>`, "gi"),
      ),
    ];
    const content = matches[0]?.[1];
    if (
      matches.length !== 1 ||
      content === undefined ||
      [...table.matchAll(new RegExp(`<\\/?${name}\\b`, "gi"))].length !== 2
    )
      throw new Error(`Expected one complete inventory ${name}`);
    return content;
  };
  return { head: section("thead"), body: section("tbody") };
}
