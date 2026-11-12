import { z } from "zod";
import {
  ImportapartCatalogSchema,
  ImportapartRecordSchema,
} from "./importapart-parser";
import {
  importapartRecordVin,
  transformImportapartRecord,
} from "./importapart-transform";
import { SourceValidationPolicy } from "./source-validation";

const pages = z.array(ImportapartCatalogSchema).max(1000);
const records = z.array(ImportapartRecordSchema).max(10_000);
const base = { source: z.literal("importapart"), version: z.literal(1) };
export const ImportapartCursorSchema = z
  .discriminatedUnion("phase", [
    z.object({ ...base, phase: z.literal("catalog"), pages }).strict(),
    z
      .object({
        ...base,
        phase: z.literal("details"),
        pages: pages.min(1),
        records,
      })
      .strict(),
    z
      .object({
        ...base,
        phase: z.literal("verify"),
        pages: pages.min(1),
        records: records.min(1),
        bookend: z.enum(["first", "last"]),
      })
      .strict(),
    z.object({ ...base, phase: z.literal("complete") }).strict(),
  ])
  .superRefine((cursor, context) => {
    if (cursor.phase === "complete") return;
    const lastPage = cursor.pages[0]?.lastPage ?? 0;
    const posts = cursor.pages.flatMap((page) => page.posts);
    let valid =
      cursor.pages.every(
        (page, index) => page.page === index + 1 && page.lastPage === lastPage,
      ) &&
      new Set(posts.map((post) => post.url)).size === posts.length &&
      posts.length <= 10_000;
    if (cursor.phase === "catalog")
      valid &&= cursor.pages.length === 0 || cursor.pages.length < lastPage;
    else {
      const vins = cursor.records.flatMap((record) => {
        const vin = importapartRecordVin(record);
        return vin ? [vin] : [];
      });
      const emitted = cursor.records.filter(
        (record) => transformImportapartRecord(record).status === "available",
      ).length;
      valid &&=
        cursor.pages.length === lastPage &&
        new Set(vins).size === vins.length &&
        cursor.records.every(
          (record, index) =>
            record.post.url === posts[index]?.url &&
            record.post.title === posts[index]?.title,
        ) &&
        (cursor.phase === "details"
          ? cursor.records.length < posts.length
          : cursor.records.length === posts.length);
      if (cursor.phase === "verify")
        valid &&=
          emitted > 0 &&
          (cursor.records.length - emitted) / cursor.records.length <=
            SourceValidationPolicy.maximumRejectionRatio;
    }
    if (!valid)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Importapart checkpoint has inconsistent native pages, donor identities or quality accounting; retain the last validated checkpoint",
      });
  });
export type ImportapartCursor = z.infer<typeof ImportapartCursorSchema>;
export const ImportapartCursor = {
  initial: { source: "importapart", version: 1, phase: "catalog", pages: [] },
} as const satisfies { initial: ImportapartCursor };
