import { z } from "zod";
import { inventoryHtmlAttribute } from "./inventory-html";
import {
  dutchersAnchors,
  dutchersDocument,
  dutchersHash,
  dutchersText,
} from "./dutchers-html";
import {
  DUTCHERS_CATEGORY,
  DUTCHERS_ORIGIN,
  DUTCHERS_STORE,
} from "./dutchers-yard-metadata";

export const DutchersScopeSchema = z
  .object({
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    quarantineReasons: z.tuple([
      z.string().min(1).max(1000),
      z.string().min(1).max(1000),
    ]),
  })
  .strict();
export type DutchersScope = z.infer<typeof DutchersScopeSchema>;

export function parseDutchersScope(raw: string): DutchersScope {
  const html = dutchersDocument(raw);
  const assertion =
    "Fresh Heavy Duty vehicles purchased for Parts. Contact us with your needs or wants";
  const headings = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map(
    (m) => dutchersText(m[1] ?? ""),
  );
  if (
    !headings.includes(assertion) ||
    !dutchersAnchors(html).some(
      (a) =>
        a.href === DUTCHERS_STORE && a.text === "Search for Heavy Truck Parts",
    ) ||
    !dutchersText(html).includes(
      "Dutcher's Inc. Automotive & Heavy Truck Parts",
    ) ||
    !html.includes("4495 Cramer Road, Morrisville, NY 13408")
  )
    throw new Error(
      "Dutcher native purchased-for-parts assertion, operator address or directly published store changed",
    );
  // Keep the source attribute too: the rendered span omits FOR SALE.
  const titles = [...html.matchAll(/<h2\b[^>]*>/gi)].flatMap(([tag]) => {
    const value = inventoryHtmlAttribute(tag, "data-title");
    return value === null ? [] : [dutchersText(value)];
  });
  const retail = titles.filter((t) => /FOR SALE/i.test(t));
  const rebuild = titles.filter((t) => /rebuild/i.test(t));
  const retailTitle = retail[0],
    rebuildTitle = rebuild[0];
  if (
    retail.length !== 1 ||
    !retailTitle?.startsWith(
      "FOR SALE. $95,000 2020 Freightliner M2 106 4X4,",
    ) ||
    rebuild.length !== 1 ||
    !rebuildTitle?.startsWith(
      "2024 Cat 306 with only 165 hours time for a rebuild runs and drives",
    )
  )
    throw new Error(
      "Dutcher explicit retail/rebuildable scope changed; review native identifiers before emission",
    );
  return {
    fingerprint: dutchersHash({ assertion, titles, store: DUTCHERS_STORE }),
    quarantineReasons: [retailTitle, rebuildTitle],
  };
}

export function parseDutchersStore(raw: string): number {
  const html = dutchersDocument(raw),
    text = dutchersText(html);
  if (
    ![
      "Dutchers Inc Heavy Truck Div NY",
      "4495 Cramer rd",
      "MORRISVILLE, NY 13408",
      "315-684-9212",
      "dedicated to our heavy truck parts division",
    ].every((s) => text.includes(s))
  )
    throw new Error(
      "Dutcher HTP physical owner, address or heavy division changed",
    );
  const links = dutchersAnchors(html).filter(
    (a) =>
      a.href === DUTCHERS_ORIGIN + DUTCHERS_CATEGORY + "?fltpc=3987345&store=1",
  );
  const match = /^Complete Vehicle - (\d+)$/.exec(links[0]?.text ?? "");
  const total = Number(match?.[1]);
  if (
    links.length !== 1 ||
    !Number.isSafeInteger(total) ||
    total < 1 ||
    total > 2000
  )
    throw new Error(
      "Dutcher store has no unique bounded Complete Vehicle total",
    );
  return total;
}
