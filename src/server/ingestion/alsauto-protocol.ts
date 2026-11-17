import {
  ALSAUTO_CATALOG,
  ALSAUTO_MAX_REQUESTS,
  alsautoPageUrl,
} from "./alsauto-configuration";
import {
  parseAlsautoOwner,
  parseAlsautoPage,
  type AlsautoPage,
  type AlsautoRecord,
} from "./alsauto-parser";

export type AlsautoProgress =
  | { kind: "pending"; url: string }
  | { kind: "ready"; records: AlsautoRecord[] };

/** Replaying an evidence prefix derives the next request, rather than trusting
 * stored pagination counters. Both censuses are actual complete HTTP traversals. */
export function inspectAlsautoEvidence(
  evidence: readonly string[],
): AlsautoProgress {
  if (evidence.length > ALSAUTO_MAX_REQUESTS)
    throw new Error("Al's evidence exceeds 82 physical requests");
  let offset = 0;
  const take = () => evidence[offset++];
  const opening = take();
  if (opening === undefined) return { kind: "pending", url: ALSAUTO_CATALOG };
  const directory = parseAlsautoOwner(opening);
  const pages: AlsautoPage[] = [];
  let next: number | null = 1;
  while (next !== null) {
    const raw = take();
    if (raw === undefined)
      return { kind: "pending", url: alsautoPageUrl(next) };
    const page = parseAlsautoPage(raw, next);
    if (
      JSON.stringify(page.makes) !== JSON.stringify(directory) ||
      (pages[0] && page.total !== pages[0].total)
    )
      throw new Error(
        "Al's opening total or make directory changed during pagination",
      );
    pages.push(page);
    next = page.next;
  }
  const records = pages.flatMap((page) => page.records);
  if (
    records.length !== pages[0]?.total ||
    new Set(records.map((record) => record.lot)).size !== records.length
  )
    throw new Error(
      "Al's complete inventory has a count mismatch or repeated native lot",
    );
  for (const page of pages) {
    const raw = take();
    if (raw === undefined)
      return { kind: "pending", url: alsautoPageUrl(page.page) };
    if (
      JSON.stringify(parseAlsautoPage(raw, page.page)) !== JSON.stringify(page)
    )
      throw new Error(
        "Al's closing inventory changed records, order, counts or pagination; retain prior inventory and restart the census",
      );
  }
  const closing = take();
  if (closing === undefined) return { kind: "pending", url: ALSAUTO_CATALOG };
  if (JSON.stringify(parseAlsautoOwner(closing)) !== JSON.stringify(directory))
    throw new Error("Al's closing owner make directory changed");
  if (offset !== evidence.length)
    throw new Error("Al's evidence contains requests after its closing owner");
  return { kind: "ready", records };
}
