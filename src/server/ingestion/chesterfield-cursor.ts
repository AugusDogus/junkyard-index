import { z } from "zod";
import { ChesterfieldQuerySchema } from "./chesterfield-parser";
import { chesterfieldDonorKey } from "./chesterfield-evidence";
import { inventoryVin } from "./inventory-vin";

const source = z.literal("chesterfield");
const bounded = z.number().int().nonnegative().max(10_000);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const owner = {
  yard: z.enum(["Richmond", "Fort Lee", "Southside"]),
  stock: z.string().regex(/^\d{12}$/),
};
const identity = { ...owner, identity: hash };
const description = {
  ...identity,
  description: hash,
  vin: z.string().min(1).max(17).nullable(),
};
const seen = z.union([
  z.object({ ...description, status: z.literal("incomplete") }).strict(),
  z
    .object({
      ...description,
      status: z.literal("available"),
      vin: z.string().min(1).max(17),
      photoHash: hash,
      blobIdentity: z.string().min(1).max(1024),
    })
    .strict(),
  z
    .object({
      ...description,
      status: z.literal("available"),
      vin: z.string().min(1).max(17),
      photoHash: z.null(),
      blobIdentity: z.null(),
    })
    .strict(),
]);
const catalog = {
  source,
  lower: z.string().regex(/^\d{4}$/),
  upper: z.string().regex(/^\d{4}$/),
  makes: z
    .array(
      z
        .object({
          id: z.string().regex(/^[1-9]\d{0,5}$/),
          label: z.string().min(1).max(300),
        })
        .strict(),
    )
    .min(1)
    .max(200),
  controls: z.array(z.object(identity).strict()).min(1).max(200),
  queries: z.array(ChesterfieldQuerySchema.strict()).max(10_000),
};
const unique = (keys: readonly unknown[]) => new Set(keys).size === keys.length;
export const ChesterfieldCursorSchema = z
  .discriminatedUnion("phase", [
    z.object({ source, phase: z.literal("start") }).strict(),
    z
      .object({ ...catalog, phase: z.literal("directories"), index: bounded })
      .strict(),
    z
      .object({
        ...catalog,
        phase: z.literal("inventory"),
        queryIndex: bounded,
        rowIndex: z.number().int().nonnegative().max(498),
        pageHash: hash.nullable(),
        seen: z.array(seen).max(10_000),
      })
      .strict(),
    z.object({ source, phase: z.literal("complete") }).strict(),
  ])
  .superRefine((cursor, context) => {
    if (cursor.phase === "start" || cursor.phase === "complete") return;
    const makes =
      cursor.phase === "directories"
        ? cursor.makes.slice(0, cursor.index)
        : cursor.makes;
    let valid =
      Number(cursor.lower) >= 1886 &&
      Number(cursor.upper) <= 2100 &&
      Number(cursor.lower) < Number(cursor.upper) &&
      unique(cursor.makes.map((m) => m.id)) &&
      unique(cursor.controls.map(chesterfieldDonorKey)) &&
      ["Richmond", "Fort Lee", "Southside"].every((yard) =>
        cursor.controls.some((c) => c.yard === yard),
      ) &&
      unique(cursor.queries.map((q) => JSON.stringify(q))) &&
      cursor.queries.every((q) => makes.some((m) => m.id === q.makeId));
    if (cursor.phase === "directories")
      valid &&= cursor.index < cursor.makes.length;
    else {
      const vins = cursor.seen.flatMap((entry) =>
        entry.vin ? [entry.vin] : [],
      );
      const available = cursor.seen.filter(
        (entry) => entry.status === "available",
      );
      valid &&=
        cursor.queries.length > 0 &&
        cursor.queryIndex < cursor.queries.length &&
        (cursor.rowIndex === 0) === (cursor.pageHash === null) &&
        (cursor.queryIndex > 0 ||
          cursor.rowIndex > 0 ||
          cursor.seen.length === 0) &&
        unique(cursor.seen.map(chesterfieldDonorKey)) &&
        unique(vins) &&
        vins.every(
          (vin) =>
            inventoryVin(vin, vin.length === 17 ? "1981" : "1980") === vin,
        ) &&
        unique(
          available.flatMap((entry) =>
            entry.photoHash ? [entry.photoHash] : [],
          ),
        ) &&
        unique(
          available.flatMap((entry) =>
            entry.blobIdentity ? [entry.blobIdentity] : [],
          ),
        );
    }
    if (!valid)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Chesterfield checkpoint directory, row, ownership or control evidence is inconsistent; restart from the last validated checkpoint",
      });
  });
export type ChesterfieldCursor = z.infer<typeof ChesterfieldCursorSchema>;
export type ChesterfieldSeen = z.infer<typeof seen>;
export const ChesterfieldCursor = {
  initial: { source: "chesterfield", phase: "start" },
} as const satisfies { initial: ChesterfieldCursor };
