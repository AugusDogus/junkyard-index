import { z } from "zod";
import {
  UWRENCH_MAX_QUERIES,
  UWRENCH_MAX_STOCKS,
  UwrenchStockSchema,
  uwrenchHash,
} from "./uwrench-parser";

export const UWRENCH_MAX_CURSOR_BYTES = 1024 * 1024;
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const entry = z
  .object({
    firstQuery: z
      .number()
      .int()
      .nonnegative()
      .max(UWRENCH_MAX_QUERIES - 1),
    record: z.record(z.string(), z.unknown()),
  })
  .strict();
const receipt = z
  .object({
    rawHash: hash,
    stableHash: hash,
    stocks: z.array(UwrenchStockSchema).max(UWRENCH_MAX_STOCKS),
  })
  .strict();
const progress = {
  source: z.literal("uwrench"),
  contextHash: hash,
  progressHash: hash,
  pairCount: z.number().int().min(1).max(UWRENCH_MAX_QUERIES),
  entries: z.array(entry).max(UWRENCH_MAX_STOCKS),
  scanReceipts: z.array(receipt).min(1).max(UWRENCH_MAX_QUERIES),
};
function wirePayload(cursor: object) {
  return Object.fromEntries(
    Object.entries(cursor).filter(([key]) => key !== "source"),
  );
}
function progressHash(value: object): string {
  return uwrenchHash(
    Object.fromEntries(
      Object.entries(value).filter(
        ([key]) => key !== "source" && key !== "progressHash",
      ),
    ),
  );
}
export const UwrenchCursorSchema = z
  .discriminatedUnion("phase", [
    z
      .object({ source: z.literal("uwrench"), phase: z.literal("start") })
      .strict(),
    z.object({ ...progress, phase: z.literal("scan") }).strict(),
    z
      .object({
        ...progress,
        phase: z.literal("verify"),
        verificationReceipts: z
          .array(z.object({ rawHash: hash }).strict())
          .max(UWRENCH_MAX_QUERIES - 1),
      })
      .strict(),
    z
      .object({ source: z.literal("uwrench"), phase: z.literal("complete") })
      .strict(),
  ])
  .superRefine((cursor, context) => {
    if (
      Buffer.byteLength(JSON.stringify(wirePayload(cursor))) >
      UWRENCH_MAX_CURSOR_BYTES
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Tri-State checkpoint exceeds 1 MiB; prior inventory/checkpoint is preserved. Inspect source growth before retrying.",
      });
    if (cursor.phase === "start" || cursor.phase === "complete") return;
    if (
      cursor.progressHash !== progressHash(cursor) ||
      cursor.scanReceipts.length > cursor.pairCount ||
      (cursor.phase === "scan" &&
        cursor.scanReceipts.length >= cursor.pairCount) ||
      (cursor.phase === "verify" &&
        (cursor.scanReceipts.length !== cursor.pairCount ||
          cursor.verificationReceipts.length >= cursor.pairCount)) ||
      cursor.entries.some(
        (entry) => entry.firstQuery >= cursor.scanReceipts.length,
      ) ||
      cursor.scanReceipts.some(
        (receipt) => new Set(receipt.stocks).size !== receipt.stocks.length,
      )
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Tri-State checkpoint prefix, whole-record checksum or query coverage is inconsistent; retain the last validated checkpoint",
      });
  });
export type UwrenchCursor = z.infer<typeof UwrenchCursorSchema>;
export type UwrenchRunningCursor = Extract<
  UwrenchCursor,
  { phase: "scan" | "verify" }
>;
export type UwrenchEntry = z.infer<typeof entry>;
export type UwrenchReceipt = z.infer<typeof receipt>;
type Checkpoint =
  | Omit<Extract<UwrenchCursor, { phase: "scan" }>, "source" | "progressHash">
  | Omit<
      Extract<UwrenchCursor, { phase: "verify" }>,
      "source" | "progressHash"
    >;
export const UwrenchCursor = {
  initial: { source: "uwrench", phase: "start" },
  checkpoint(value: Checkpoint): UwrenchRunningCursor {
    const parsed = UwrenchCursorSchema.parse({
      ...value,
      source: "uwrench",
      progressHash: progressHash(value),
    });
    if (parsed.phase === "start" || parsed.phase === "complete")
      throw new Error("Expected a running Tri-State checkpoint");
    return parsed;
  },
  parse(raw: string): UwrenchCursor {
    if (Buffer.byteLength(raw) > UWRENCH_MAX_CURSOR_BYTES)
      throw new Error(
        "Tri-State serialized checkpoint exceeds 1 MiB; retain the last validated checkpoint",
      );
    const value: unknown = JSON.parse(raw);
    if (
      typeof value !== "object" ||
      value === null ||
      Array.isArray(value) ||
      ("source" in value && value.source !== "uwrench")
    )
      throw new Error("Invalid Tri-State checkpoint payload");
    return UwrenchCursorSchema.parse({ ...value, source: "uwrench" });
  },
  serialize(cursor: UwrenchCursor): string {
    return JSON.stringify(wirePayload(UwrenchCursorSchema.parse(cursor)));
  },
} as const satisfies {
  initial: UwrenchCursor;
  checkpoint: (value: Checkpoint) => UwrenchRunningCursor;
  parse: (raw: string) => UwrenchCursor;
  serialize: (cursor: UwrenchCursor) => string;
};
