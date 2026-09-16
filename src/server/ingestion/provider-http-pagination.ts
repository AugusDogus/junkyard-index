/** Link relations can contain multiple whitespace-separated tokens. WordPress
 * API discovery links are not pagination and must remain acceptable.
 */
export function hasHttpPaginationLink(headers: Headers): boolean {
  for (const match of (headers.get("link") ?? "").matchAll(
    /(?:^|;)\s*rel\s*=\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|([^;,\s]+))/gi,
  )) {
    const relations = (match[1] ?? match[2] ?? match[3] ?? "")
      .replace(/\\(.)/g, "$1")
      .toLowerCase()
      .split(/\s+/);
    if (
      relations.some((relation) =>
        ["next", "prev", "first", "last"].includes(relation),
      )
    )
      return true;
  }
  return false;
}
