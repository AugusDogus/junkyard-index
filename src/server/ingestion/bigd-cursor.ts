import { createHash } from "node:crypto";
import { z } from "zod";
import { BigdRecordSchema } from "./bigd-parser";
import { BIGD_MINIMUM_INVENTORY, BIGD_YARD } from "./bigd-yard-metadata";
export const bigdHash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const BIGD_MAX_CURSOR_BYTES = 1024 * 1024;
const base = { source: z.literal("bigd"), version: z.literal(1) };
const scope = z.literal(
  bigdHash([
    BIGD_YARD,
    BIGD_MINIMUM_INVENTORY,
    "complete-inline-table-check-digit-v1",
  ]),
);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const records = z.array(BigdRecordSchema).min(1).max(10_000);
const progress = z.discriminatedUnion("phase", [
  z
    .object({ ...base, scope, checksum: hash, phase: z.literal("owner") })
    .strict(),
  z
    .object({ ...base, scope, checksum: hash, phase: z.literal("catalog") })
    .strict(),
  z
    .object({
      ...base,
      scope,
      checksum: hash,
      phase: z.literal("closing"),
      records,
    })
    .strict(),
  z
    .object({
      ...base,
      scope,
      checksum: hash,
      phase: z.literal("closing-owner"),
      records,
    })
    .strict(),
]);
export const BigdCursorSchema = z
  .union([
    progress,
    z.object({ ...base, phase: z.literal("complete") }).strict(),
  ])
  .superRefine((state, context) => {
    if (state.phase === "complete") return;
    if (
      Buffer.byteLength(JSON.stringify(state)) > BIGD_MAX_CURSOR_BYTES ||
      state.checksum !== bigdHash({ ...state, checksum: null })
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Big D checkpoint size or checksum changed; restart the census",
      });
  });
export type BigdCursor = z.infer<typeof BigdCursorSchema>;
export type BigdProgress = z.infer<typeof progress>;
function checkpoint(value: unknown): BigdProgress {
  const parsed = progress.parse(value);
  const checked = BigdCursorSchema.parse({
    ...parsed,
    checksum: bigdHash({ ...parsed, checksum: null }),
  });
  if (checked.phase === "complete")
    throw new Error("Expected a Big D progress checkpoint");
  return checked;
}
export const BigdCursor = {
  initial: checkpoint({
    source: "bigd",
    version: 1,
    scope: scope.value,
    checksum: "0".repeat(64),
    phase: "owner",
  }),
  checkpoint,
  serialize(value: BigdCursor) {
    return JSON.stringify(BigdCursorSchema.parse(value));
  },
  parse(raw: string) {
    if (Buffer.byteLength(raw) > BIGD_MAX_CURSOR_BYTES)
      throw new Error(
        "Big D checkpoint exceeds 1 MiB; retain the previous checkpoint",
      );
    const value: unknown = JSON.parse(raw);
    return BigdCursorSchema.parse(value);
  },
} as const;
