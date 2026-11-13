import { z } from "zod";
import { BigtruckpageCatalogSchema } from "./bigtruckpage-parser";
import { BigtruckpageProfileSchema } from "./bigtruckpage-yard-metadata";
import {
  bigtruckpageRecordVin,
  transformBigtruckpageRecord,
} from "./bigtruckpage-transform";
import { SourceValidationPolicy } from "./source-validation";

const base = { source: z.literal("bigtruckpage"), version: z.literal(1) };
const pages = z.array(BigtruckpageCatalogSchema).max(500);
export const BigtruckpageCursorSchema = z
  .discriminatedUnion("phase", [
    z.object({ ...base, phase: z.literal("profile") }).strict(),
    z
      .object({
        ...base,
        phase: z.literal("catalog"),
        profile: BigtruckpageProfileSchema,
        pages,
      })
      .strict(),
    z
      .object({
        ...base,
        phase: z.literal("verify"),
        profile: BigtruckpageProfileSchema,
        pages: pages.min(1),
        nextPage: z.number().int().min(1).max(500),
      })
      .strict(),
    z.object({ ...base, phase: z.literal("complete") }).strict(),
  ])
  .superRefine((cursor, context) => {
    if (cursor.phase === "complete" || cursor.phase === "profile") return;
    const first = cursor.pages[0];
    const records = cursor.pages.flatMap((page) => page.records);
    const vins = records.flatMap((record) => {
      const vin = bigtruckpageRecordVin(record);
      return vin ? [vin] : [];
    });
    let valid =
      cursor.pages.every(
        (page, index) =>
          page.page === index + 1 &&
          page.lastPage === first?.lastPage &&
          page.total === first?.total,
      ) &&
      new Set(records.map((record) => record.url)).size === records.length &&
      new Set(vins).size === vins.length &&
      records.length <= 10_000;
    if (cursor.phase === "catalog")
      valid &&= first === undefined || cursor.pages.length < first.lastPage;
    else {
      const accepted = records.filter(
        (record) => transformBigtruckpageRecord(record).status === "available",
      ).length;
      valid &&=
        first !== undefined &&
        cursor.pages.length === first.lastPage &&
        records.length === first.total &&
        cursor.nextPage <= first.lastPage &&
        accepted > 0 &&
        (records.length - accepted) / records.length <=
          SourceValidationPolicy.maximumRejectionRatio;
    }
    if (!valid)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "BigTruckPage checkpoint contradicts native contiguous totals, unique donor identities or the unchanged 10% required-field rejection limit; retain the last validated checkpoint",
      });
  });
export type BigtruckpageCursor = z.infer<typeof BigtruckpageCursorSchema>;
export const BigtruckpageCursor = {
  initial: { source: "bigtruckpage", version: 1, phase: "profile" },
} as const satisfies { initial: BigtruckpageCursor };
