import { createHash } from "node:crypto";
import { z } from "zod";
import {
  inventoryHtmlAttribute,
  stripInventoryRawText,
} from "./inventory-html";
import { prattElements, prattText } from "./pratt-html";
import {
  LONESTARIMPORTS_DOCUMENTS,
  LONESTARIMPORTS_MAX_BODY_BYTES,
  LONESTARIMPORTS_MAX_PAGES,
  LONESTARIMPORTS_ORIGIN,
} from "./lonestarimports-yard-metadata";

export const lonestarimportsHash = (value: unknown): string =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const text = z.string().max(2_000).nullable();
export const LonestarimportsRecordSchema = z
  .object({
    Stock: text,
    License: text,
    Make: text,
    Manufacturer: text,
    Model: text,
    ModelLong: text,
    PriImpact: text,
    VIN: text,
    Yr: z.number().int().nullable(),
    DateEntered: text,
    Description: text,
    GUID: text,
    PrimaryImageId: text,
  })
  .strict();
export type LonestarimportsRecord = z.infer<typeof LonestarimportsRecordSchema>;
export const LonestarimportsPageSchema = z
  .object({
    data: z.array(LonestarimportsRecordSchema).max(20),
    pagination: z
      .object({
        page: z.number().int().min(1).max(LONESTARIMPORTS_MAX_PAGES),
        limit: z.literal(20),
        total: z
          .number()
          .int()
          .min(1)
          .max(20 * LONESTARIMPORTS_MAX_PAGES),
        hasMore: z.boolean(),
        totalPages: z.number().int().min(1).max(LONESTARIMPORTS_MAX_PAGES),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, context) => {
    const p = value.pagination;
    if (
      p.totalPages !== Math.ceil(p.total / 20) ||
      p.page > p.totalPages ||
      p.hasMore !== p.page < p.totalPages ||
      value.data.length !== Math.min(20, p.total - (p.page - 1) * 20)
    )
      context.addIssue({
        code: "custom",
        message:
          "Lonestar native pagination/count/terminal controls are inconsistent",
      });
  });
export type LonestarimportsPage = z.infer<typeof LonestarimportsPageSchema>;
export function parseLonestarimportsPage(raw: string): LonestarimportsPage {
  if (!raw.length || Buffer.byteLength(raw) > LONESTARIMPORTS_MAX_BODY_BYTES)
    throw new Error("Lonestar native inventory response is empty or oversized");
  return LonestarimportsPageSchema.parse(JSON.parse(raw));
}

/** Actual independent owner/control proofs. Optional email obfuscation is not an inventory control. */
export function parseLonestarimportsDocument(
  raw: string,
  index: number,
): string {
  const path = LONESTARIMPORTS_DOCUMENTS[index];
  const html = stripInventoryRawText(raw);
  if (
    !path ||
    Buffer.byteLength(raw) > LONESTARIMPORTS_MAX_BODY_BYTES ||
    [/<html\b/gi, /<body\b/gi, /<\/body\s*>/gi, /<\/html\s*>/gi].some(
      (p) => [...html.matchAll(p)].length !== 1,
    ) ||
    !/<\/body\s*>\s*<\/html\s*>\s*$/i.test(html)
  )
    throw new Error(
      "Lonestar ownership/control document is incomplete, oversized or unclassified",
    );
  const visible = prattText(html);
  if (
    /access denied|just a moment|verify you are human|captcha|checking your browser/i.test(
      visible,
    )
  )
    throw new Error(
      "Lonestar returned access-control content; retain prior inventory and stop",
    );
  const canonicals = [...html.matchAll(/<link\b[^>]*>/gi)].filter(
    ([tag]) => inventoryHtmlAttribute(tag, "rel") === "canonical",
  );
  const hrefs = [...html.matchAll(/<a\b[^>]*>/gi)].map(([tag]) =>
    inventoryHtmlAttribute(tag, "href"),
  );
  const footer = prattElements(html, "footer");
  if (
    canonicals.length !== 1 ||
    inventoryHtmlAttribute(canonicals[0]?.[0] ?? "", "href") !==
      LONESTARIMPORTS_ORIGIN + path ||
    footer.length !== 1 ||
    !["LONESTAR", "6621 Liberty Rd", "Houston, TX 77028"].every((v) =>
      prattText(footer[0]?.body ?? "").includes(v),
    ) ||
    !hrefs.includes("tel:+17137855151") ||
    !hrefs.includes("/new-arrivals") ||
    !hrefs.includes("/search")
  )
    throw new Error(
      "Lonestar native owner/address/phone/inventory destinations changed",
    );
  if (
    index === 0 &&
    !["since 1989", "22 acres"].every((v) => visible.includes(v))
  )
    throw new Error("Lonestar independent physical facility assertion changed");
  if (
    index === 1 &&
    !["3,000+", "Vehicles in Inventory", "dismantle"].every((v) =>
      visible.includes(v),
    )
  )
    throw new Error("Lonestar own-yard donor inventory assertion changed");
  if (
    index === 2 &&
    !hrefs.some((h) =>
      h?.includes(
        "!1s0x8640bbe646c39ea3:0x2548afb4706e332f!8m2!3d29.7951041!4d-95.2997656",
      ),
    )
  )
    throw new Error("Lonestar address-bound named destination point changed");
  const next = prattElements(
    raw,
    "script",
    (tag) => inventoryHtmlAttribute(tag, "id") === "__NEXT_DATA__",
  );
  if (next.length !== 1)
    throw new Error("Lonestar native application control document is missing");
  const data = z
    .object({ page: z.literal(path), buildId: z.string().min(1).max(200) })
    .passthrough()
    .parse(JSON.parse(next[0]?.body ?? ""));
  const scripts = [...raw.matchAll(/<script\b[^>]*>/gi)]
    .map(([tag]) => inventoryHtmlAttribute(tag, "src"))
    .filter((v) => v?.startsWith("/_next/"));
  if (
    !scripts.length ||
    (index === 3 && !scripts.some((v) => v?.includes("/pages/new-arrivals-")))
  )
    throw new Error(
      "Lonestar published inventory application controls changed",
    );
  return lonestarimportsHash({
    path,
    visible,
    build: data.buildId,
    scripts,
    inventoryLinks: hrefs.filter(
      (v) => v === "/new-arrivals" || v === "/search",
    ),
  });
}
