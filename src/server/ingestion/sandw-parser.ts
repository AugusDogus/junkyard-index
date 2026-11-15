import { createHash } from "node:crypto";
import { z } from "zod";
import {
  inventoryHtmlAttribute,
  stripInventoryRawText,
} from "./inventory-html";
import { SANDW_CATALOG, SANDW_OWNER, SANDW_YARD } from "./sandw-yard-metadata";

const text = z.string().max(500).nullish();
export const SandwRecordSchema = z
  .object({
    year: z.union([z.number(), z.string().max(20)]).nullish(),
    make: text,
    model: text,
    vin: text,
    vinLast6: text,
    stockNumber: z.unknown().optional(),
    color: z.unknown().optional(),
    location: z.unknown().optional(),
    arrivalDate: z.unknown().optional(),
    imageUrl: z.unknown().optional(),
  })
  .strict();
export type SandwRecord = z.infer<typeof SandwRecordSchema>;
export const SandwInventorySchema = z
  .object({
    status: z.enum(["current", "stale"]),
    lastSyncedAt: z.string().datetime(),
    vehicles: z.array(SandwRecordSchema).min(1).max(10_000),
  })
  .strict();
export type SandwInventory = z.infer<typeof SandwInventorySchema>;
export const sandwHash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

export function parseSandwInventory(raw: string): SandwInventory {
  if (Buffer.byteLength(raw) > 2 * 1024 * 1024)
    throw new Error("S&W inventory response exceeds the 2 MiB bound");
  // Extra top-level pagination/filter controls fail closed. The native client
  // performs filtering and its 48-card Show More operation on this entire array.
  return SandwInventorySchema.parse(JSON.parse(raw));
}

function document(raw: string, url: string) {
  const html = stripInventoryRawText(raw);
  if (
    Buffer.byteLength(raw) > 2 * 1024 * 1024 ||
    !/<\/body\s*>\s*<\/html\s*>\s*$/i.test(html)
  )
    throw new Error("S&W identity document is oversized or truncated");
  const canonicals = [...html.matchAll(/<link\b[^>]*>/gi)].filter(
    ([tag]) => inventoryHtmlAttribute(tag, "rel") === "canonical",
  );
  if (
    canonicals.length !== 1 ||
    inventoryHtmlAttribute(canonicals[0]?.[0] ?? "", "href") !== url
  )
    throw new Error("S&W requested identity destination changed");
  const body = html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
  if (
    ![
      SANDW_YARD.name,
      SANDW_YARD.address,
      "Lithonia, GA 30058",
      "(770) 482-9500",
    ].every((value) => body.includes(value))
  )
    throw new Error("S&W native U-Pull operator, address or phone changed");
  return body;
}

export function parseSandwOwner(raw: string): string {
  const body = document(raw, SANDW_OWNER);
  if (
    !["Bring Your Own Tools", "$2 Admission", "S&W Full Service"].every(
      (value) => body.includes(value),
    )
  )
    throw new Error("S&W own-yard U-Pull scope changed");
  return sandwHash(SANDW_YARD);
}

export function parseSandwScope(raw: string): void {
  const body = document(raw, SANDW_CATALOG);
  if (
    ![
      "Search U-Pull Vehicles",
      "Listings come from the daily CRUSH yard report.",
      "U-Pull Vehicle Inventory",
      "If you see your vehicle here, come on down to pull your part",
    ].every((value) => body.includes(value))
  )
    throw new Error(
      "S&W native vehicle-report membership or owned-yard binding changed",
    );
}
