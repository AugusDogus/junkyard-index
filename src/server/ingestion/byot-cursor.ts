import { createHash } from "node:crypto";
import { z } from "zod";
import { BYOT_YARDS } from "./byot-configuration";
import { BYOT_DAILY_QUERIES, BYOT_QUERIES } from "./byot-directory";
import { ByotResult } from "./byot-result";

export const BYOT_MAX_CURSOR_BYTES = 16 * 1024 * 1024;
export const BYOT_CACHE_MAX_AGE_MS = 8 * 24 * 60 * 60 * 1000;
export const BYOT_MAX_RUN_MS = 2 * 60 * 60 * 1000;
export const BYOT_RUN_REQUESTS = BYOT_YARDS.length * (1 + BYOT_DAILY_QUERIES);
export const byotHash = (value: unknown): string =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const scope = byotHash({ yards: BYOT_YARDS, queries: BYOT_QUERIES });
const records = z.array(z.unknown()).max(4999);
const bucket = z
  .object({
    index: z
      .number()
      .int()
      .min(0)
      .max(BYOT_QUERIES.length - 1),
    checkedAt: z.number().int().nonnegative(),
    records,
  })
  .strict();
const cache = z
  .array(z.array(bucket).max(BYOT_QUERIES.length))
  .length(BYOT_YARDS.length);
const base = {
  source: z.literal("byot"),
  version: z.literal(1),
  scope: z.literal(scope),
  checksum: z.string().regex(/^[a-f0-9]{64}$/),
};
const active = {
  ...base,
  startedAt: z.number().int().nonnegative(),
  sweepStart: z
    .number()
    .int()
    .min(0)
    .max(BYOT_QUERIES.length - 1),
  cache,
  previousCounts: z
    .array(z.number().int().nonnegative())
    .max(BYOT_YARDS.length),
};
const schema = z.discriminatedUnion("phase", [
  z.object({ ...base, phase: z.literal("initial") }).strict(),
  z
    .object({
      ...active,
      phase: z.literal("arrivals"),
      feeds: z.array(records).max(BYOT_YARDS.length - 1),
    })
    .strict(),
  z
    .object({
      ...active,
      phase: z.literal("search"),
      feeds: z.array(records).length(BYOT_YARDS.length),
      progress: z
        .number()
        .int()
        .min(0)
        .max(BYOT_DAILY_QUERIES * BYOT_YARDS.length - 1),
    })
    .strict(),
  z
    .object({
      ...active,
      phase: z.literal("ready"),
      feeds: z.array(records).length(BYOT_YARDS.length),
    })
    .strict(),
  z
    .object({
      ...base,
      phase: z.literal("complete"),
      completedAt: z.number().int().nonnegative(),
      nextOffset: z
        .number()
        .int()
        .min(0)
        .max(BYOT_QUERIES.length - 1),
      cache,
      yardCounts: z
        .array(z.number().int().nonnegative())
        .length(BYOT_YARDS.length),
    })
    .strict(),
]);
export type ByotCursor = z.infer<typeof schema>;
export type ByotCache = z.infer<typeof cache>;
type Unsigned<C = ByotCursor> = C extends { checksum: string }
  ? Omit<C, "checksum">
  : never;
const checksum = (cursor: ByotCursor | Unsigned) =>
  byotHash({ ...cursor, checksum: undefined });
function validate(input: unknown): ByotCursor {
  if (Buffer.byteLength(JSON.stringify(input)) > BYOT_MAX_CURSOR_BYTES)
    throw new Error("Checkpoint exceeds 16 MiB");
  const cursor = schema.parse(input);
  if (cursor.checksum !== checksum(cursor))
    throw new Error("Checkpoint checksum or qualified directory changed");
  if (cursor.phase === "initial") return cursor;
  if (
    "previousCounts" in cursor &&
    cursor.previousCounts.length !== 0 &&
    cursor.previousCounts.length !== BYOT_YARDS.length
  )
    throw new Error("Previous yard counts are incomplete");
  const now = "startedAt" in cursor ? cursor.startedAt : cursor.completedAt;
  for (const yard of cursor.cache) {
    if (new Set(yard.map((entry) => entry.index)).size !== yard.length)
      throw new Error("Search cache repeats a query index");
    if (
      yard.some(
        (entry) =>
          entry.checkedAt > now ||
          now - entry.checkedAt > BYOT_CACHE_MAX_AGE_MS,
      )
    )
      throw new Error("Search evidence is expired or dated in the future");
  }
  // Prove this run's complete contiguous search prefix before accepting a checkpoint.
  if (
    cursor.phase === "search" ||
    cursor.phase === "ready" ||
    cursor.phase === "complete"
  ) {
    const progress =
      cursor.phase === "search"
        ? cursor.progress
        : BYOT_DAILY_QUERIES * BYOT_YARDS.length;
    const start =
      cursor.phase === "complete"
        ? (cursor.nextOffset - BYOT_DAILY_QUERIES + BYOT_QUERIES.length) %
          BYOT_QUERIES.length
        : cursor.sweepStart;
    for (let i = 0; i < progress; i++) {
      const index =
        (start + Math.floor(i / BYOT_YARDS.length)) % BYOT_QUERIES.length;
      const entry = cursor.cache[i % BYOT_YARDS.length]?.find(
        (item) => item.index === index,
      );
      if (!entry || entry.checkedAt !== now)
        throw new Error(
          "Checkpoint lacks this run's contiguous search evidence",
        );
    }
  }
  return cursor;
}
function seal(state: Unsigned): ByotCursor {
  const canonical = schema.parse({ ...state, checksum: "0".repeat(64) });
  return validate({ ...canonical, checksum: checksum(canonical) });
}
export const ByotCursor = {
  initial: (): ByotCursor =>
    seal({ source: "byot", version: 1, scope, phase: "initial" }),
  parse: (input: unknown) =>
    ByotResult.boundary("checkpoint", () => validate(input)),
  checkpoint: (state: Unsigned) =>
    ByotResult.boundary("checkpoint transition", () => seal(state)),
  fromWire: (raw: string) =>
    ByotResult.boundary("checkpoint wire", () => {
      if (Buffer.byteLength(raw) > BYOT_MAX_CURSOR_BYTES)
        throw new Error("Checkpoint exceeds 16 MiB");
      return validate(JSON.parse(raw));
    }),
  serialize: (cursor: ByotCursor) =>
    ByotResult.boundary("checkpoint serialization", () =>
      JSON.stringify(validate(cursor)),
    ),
  begin(previous: ByotCursor | null, now: number) {
    return ByotResult.boundary("daily sweep initialization", () => {
      if (previous !== null) validate(previous);
      if (previous !== null && previous.phase !== "complete")
        throw new Error("Previous sweep is not a complete published run");
      if (previous?.phase === "complete" && now < previous.completedAt)
        throw new Error("Previous publication is dated in the future");
      return seal({
        source: "byot",
        version: 1,
        scope,
        phase: "arrivals",
        startedAt: now,
        sweepStart: previous?.phase === "complete" ? previous.nextOffset : 0,
        cache:
          previous?.phase === "complete"
            ? previous.cache.map((yard) =>
                yard.filter(
                  (entry) => now - entry.checkedAt <= BYOT_CACHE_MAX_AGE_MS,
                ),
              )
            : BYOT_YARDS.map(() => []),
        previousCounts:
          previous?.phase === "complete" ? previous.yardCounts : [],
        feeds: [],
      });
    });
  },
} as const;
