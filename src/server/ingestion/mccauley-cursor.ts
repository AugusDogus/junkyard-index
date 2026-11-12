import { z } from "zod";
import {
  MccauleyCatalogSchema,
  MccauleyCurrentSchema,
  MccauleyDetailSchema,
} from "./mccauley-parser";
import {
  mccauleySnapshot,
  validateMccauleySnapshot,
} from "./mccauley-snapshot";

const base = { source: z.literal("mccauley"), version: z.literal(1) };
const evidence = {
  catalog: MccauleyCatalogSchema,
  current: MccauleyCurrentSchema,
  details: z.array(MccauleyDetailSchema).max(100),
};
export const MccauleyCursorSchema = z
  .discriminatedUnion("phase", [
    z.object({ ...base, phase: z.literal("start") }).strict(),
    z
      .object({
        ...base,
        phase: z.literal("current-list"),
        catalog: MccauleyCatalogSchema,
      })
      .strict(),
    z.object({ ...base, phase: z.literal("details"), ...evidence }).strict(),
    z
      .object({ ...base, phase: z.literal("verify-index"), ...evidence })
      .strict(),
    z
      .object({ ...base, phase: z.literal("verify-current"), ...evidence })
      .strict(),
    z.object({ ...base, phase: z.literal("complete") }).strict(),
  ])
  .superRefine((cursor, context) => {
    if (Buffer.byteLength(JSON.stringify(cursor)) > 512 * 1024) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "McCauley checkpoint exceeds 512 KiB",
      });
      return;
    }
    if (
      cursor.phase === "start" ||
      cursor.phase === "current-list" ||
      cursor.phase === "complete"
    )
      return;
    const nativePrefix = cursor.details.every(
      (detail, index) =>
        detail.post.url === cursor.catalog.posts[index]?.url &&
        detail.post.label === cursor.catalog.posts[index]?.label,
    );
    try {
      if (
        !nativePrefix ||
        (cursor.phase === "details"
          ? cursor.details.length >= cursor.catalog.posts.length
          : cursor.details.length !== cursor.catalog.posts.length)
      )
        throw new Error(
          "McCauley checkpoint has inconsistent native detail order or count",
        );
      const snapshot = mccauleySnapshot(cursor.current, cursor.details);
      if (cursor.phase !== "details") validateMccauleySnapshot(snapshot);
    } catch (cause) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          cause instanceof Error
            ? cause.message
            : "Invalid McCauley native checkpoint evidence",
      });
    }
  });
export type MccauleyCursor = z.infer<typeof MccauleyCursorSchema>;
export const MccauleyCursor = {
  initial: { source: "mccauley", version: 1, phase: "start" },
} as const satisfies { initial: MccauleyCursor };
