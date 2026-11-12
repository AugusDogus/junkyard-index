import { z } from "zod";
import { inventoryVin } from "./inventory-vin";
import { UtpapPhotoRowSchema, UtpapRecordSchema } from "./utpap-parser";
import { parseUtpapDonor } from "./utpap-transform";

const yard = z.enum(["1064", "1065"]);
const count = z.number().int().nonnegative().max(10_000);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const history = z
  .object({
    vins: z.array(z.string().min(5).max(17)).max(10_000),
    hashes: z.array(hash).max(10_000),
  })
  .strict();
// Legacy checkpoints may have skipped donors for fields that are now optional.
const base = {
  source: z.literal("utpap"),
  version: z.literal(2),
  yardCode: yard,
  history,
};
const records = z.array(UtpapRecordSchema.strict()).min(1).max(10_000);
const joined = z
  .object({
    record: UtpapRecordSchema.strict(),
    photo: z.string().max(1000).nullable(),
  })
  .strict();
const unique = (values: readonly string[]) =>
  new Set(values).size === values.length;
export const UtpapCursorSchema = z
  .discriminatedUnion("phase", [
    z.object({ ...base, phase: z.literal("start") }).strict(),
    z
      .object({
        ...base,
        phase: z.literal("makes"),
        records,
        makes: z.array(z.string().min(1).max(500)).min(1).max(200),
        index: count,
        photos: z.array(UtpapPhotoRowSchema).max(10_000),
      })
      .strict(),
    z
      .object({
        ...base,
        phase: z.literal("photos"),
        donors: z.array(joined).min(1).max(10_000),
        index: count,
        rejected: count,
        emitted: count,
        vins: z.array(z.string().min(5).max(17)).max(10_000),
        hashes: z.array(hash).max(10_000),
      })
      .strict(),
    z
      .object({ source: z.literal("utpap"), phase: z.literal("complete") })
      .strict(),
  ])
  .superRefine((cursor, context) => {
    if (cursor.phase === "complete") return;
    let valid =
      unique(cursor.history.vins) &&
      unique(cursor.history.hashes) &&
      cursor.history.vins.every(
        (v) => inventoryVin(v, v.length === 17 ? "1981" : "1980") === v,
      ) &&
      (cursor.yardCode === "1065" ||
        (cursor.history.vins.length === 0 &&
          cursor.history.hashes.length === 0));
    if (cursor.phase === "makes") {
      const makes = [...new Set(cursor.records.map((r) => r.MAKE))].sort();
      const processed = new Set(cursor.makes.slice(0, cursor.index));
      valid &&=
        cursor.records.every((r) => r.S3CLIENTID === cursor.yardCode) &&
        unique(cursor.records.map((r) => r.STOCKNUMBER)) &&
        JSON.stringify(makes) === JSON.stringify(cursor.makes) &&
        cursor.index < cursor.makes.length &&
        unique(cursor.photos.map((p) => p.stock)) &&
        cursor.photos.every((p) => processed.has(p.make));
    }
    if (cursor.phase === "photos") {
      const expectedVins = cursor.donors.slice(0, cursor.index).flatMap((d) => {
        const vin = inventoryVin(d.record.VIN, d.record.iYEAR);
        return vin ? [vin] : [];
      });
      const available = cursor.donors.slice(0, cursor.index).flatMap((d) => {
        const result = parseUtpapDonor(d.record, d.photo, cursor.yardCode);
        return result.status === "available" ? [result.donor] : [];
      });
      valid &&=
        cursor.index < cursor.donors.length &&
        cursor.index === cursor.rejected + cursor.emitted &&
        cursor.emitted === available.length &&
        cursor.hashes.length ===
          available.filter((donor) => donor.photoUrl !== null).length &&
        JSON.stringify(expectedVins) === JSON.stringify(cursor.vins) &&
        cursor.donors.every((d) => d.record.S3CLIENTID === cursor.yardCode) &&
        unique(cursor.donors.map((d) => d.record.STOCKNUMBER)) &&
        unique([...cursor.history.vins, ...cursor.vins]) &&
        unique([...cursor.history.hashes, ...cursor.hashes]);
    }
    if (!valid)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Utah checkpoint ownership, identities, make partitions or photo accounting is inconsistent; retain the last validated checkpoint",
      });
  });
export type UtpapCursor = z.infer<typeof UtpapCursorSchema>;
export const UtpapCursor = {
  initial: {
    source: "utpap",
    version: 2,
    phase: "start",
    yardCode: "1064",
    history: { vins: [], hashes: [] },
  },
} as const satisfies { initial: UtpapCursor };
