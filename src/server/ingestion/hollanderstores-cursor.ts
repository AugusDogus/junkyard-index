import { z } from "zod";
import {
  HollanderstoresPageSchema,
  HollanderstoresRowSchema,
} from "./hollanderstores-parser";
import {
  HOLLANDERSTORES_YARDS,
  hollanderstoresUsesPaging,
  hollanderstoresPageCount,
  hollanderstoresDestination,
} from "./hollanderstores-yard-metadata";
import { hollanderstoresVin } from "./hollanderstores-vin";

import {
  HOLLANDERSTORES_MAX_CURSOR_BYTES,
  HOLLANDERSTORES_MAX_REQUESTS,
  HOLLANDERSTORES_MAX_ROWS,
} from "./hollanderstores-limits";
export { HOLLANDERSTORES_MAX_CURSOR_BYTES } from "./hollanderstores-limits";
const yardCount = HOLLANDERSTORES_YARDS.length;
// Pure JS corruption checksum so workflow-side cursor imports need no Node modules.
function checksum(value: unknown): string {
  let hash = 2166136261;
  for (const char of JSON.stringify(value))
    hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(16).padStart(8, "0");
}
const scope = checksum([
  HOLLANDERSTORES_YARDS,
  "card-or-paged-list/blank-make-vpic/check-digit/bounded-census-v3",
]);
const pendingSchema = z
  .object({
    yard: z.string(),
    total: z.number().int().positive().max(25_000),
    rows: z.array(HollanderstoresRowSchema).min(20).max(25_000),
  })
  .strict();
const common = {
  source: z.literal("hollanderstores"),
  version: z.literal(1),
  scope: z.literal(scope),
  startedAt: z.number().int().nonnegative(),
  previousAcceptedCount: z.number().int().nonnegative().nullable(),
  pages: z.array(HollanderstoresPageSchema).max(yardCount),
  pending: pendingSchema.nullable(),
  decoded: z.record(
    z.string().regex(/^[A-HJ-NPR-Z0-9]{17}$/),
    z.string().trim().min(1).max(100).nullable(),
  ),
  requests: z.number().int().nonnegative().max(HOLLANDERSTORES_MAX_REQUESTS),
};
const schema = z.discriminatedUnion("phase", [
  z.object({ ...common, phase: z.literal("opening") }).strict(),
  z.object({ ...common, phase: z.literal("decoding") }).strict(),
  z
    .object({
      ...common,
      phase: z.literal("closing"),
      closed: z
        .number()
        .int()
        .min(0)
        .max(yardCount - 1),
    })
    .strict(),
  z
    .object({
      ...common,
      phase: z.literal("ready"),
      closed: z
        .number()
        .int()
        .refine((value) => value === yardCount),
    })
    .strict(),
  z
    .object({
      ...common,
      phase: z.literal("complete"),
      closed: z
        .number()
        .int()
        .refine((value) => value === yardCount),
    })
    .strict(),
]);
export type HollanderstoresState = z.infer<typeof schema>;
export type HollanderstoresCursor = HollanderstoresState & { checksum: string };
export function hollanderstoresMissing(
  state: Pick<HollanderstoresState, "pages">,
): string[] {
  return [
    ...new Set(
      state.pages.flatMap((page) =>
        page.rows.flatMap((row) => {
          if (row.make?.trim()) return [];
          const vin = hollanderstoresVin(row.vin);
          return vin ? [vin] : [];
        }),
      ),
    ),
  ];
}
function checkpoint(value: unknown): HollanderstoresCursor {
  const state = schema.parse(value);
  const needed = hollanderstoresMissing(state),
    decoded = Object.keys(state.decoded);
  const closed = "closed" in state ? state.closed : 0;
  const pending = state.pending;
  const yard =
    HOLLANDERSTORES_YARDS[
      state.phase === "opening" ? state.pages.length : closed
    ];
  const pageRequests = (pages: typeof state.pages) =>
    pages.reduce(
      (sum, page) =>
        sum + hollanderstoresPageCount({ code: page.yard }, page.total),
      0,
    );
  if (
    pending &&
    (!yard ||
      !hollanderstoresUsesPaging(yard) ||
      pending.yard !== yard.code ||
      (state.phase !== "opening" && state.phase !== "closing") ||
      pending.rows.length >= pending.total ||
      pending.rows.length % 20 !== 0 ||
      new Set(pending.rows.map((row) => row.url)).size !==
        pending.rows.length ||
      pending.rows.some((row) => !hollanderstoresDestination(row.url, yard)))
  )
    throw new Error(
      "Hollander Stores checkpoint lost its ordered partial list roster",
    );
  if (
    state.pages.reduce(
      (sum, page) => sum + page.total,
      state.phase === "opening" ? (pending?.total ?? 0) : 0,
    ) > HOLLANDERSTORES_MAX_ROWS ||
    (state.requests === 0 ? state.startedAt !== 0 : state.startedAt <= 0) ||
    state.pages.some(
      (page, index) => page.yard !== HOLLANDERSTORES_YARDS[index]?.code,
    ) ||
    (state.phase === "opening"
      ? state.pages.length >= yardCount || decoded.length !== 0
      : state.pages.length !== yardCount) ||
    decoded.some((vin, index) => vin !== needed[index]) ||
    (decoded.length !== needed.length && decoded.length % 50 !== 0) ||
    (state.phase !== "opening" &&
      state.phase !== "decoding" &&
      decoded.length !== needed.length) ||
    (state.phase === "decoding" && decoded.length === needed.length) ||
    state.requests !==
      pageRequests(state.pages) +
        Math.ceil(decoded.length / 50) +
        pageRequests(state.pages.slice(0, closed)) +
        (pending ? pending.rows.length / 20 : 0)
  )
    throw new Error(
      "Hollander Stores checkpoint lost ordered complete yards, decode batches or closing evidence",
    );
  const result = { ...state, checksum: checksum(state) };
  if (
    Buffer.byteLength(JSON.stringify(result)) > HOLLANDERSTORES_MAX_CURSOR_BYTES
  )
    throw new Error("Hollander Stores checkpoint exceeds 32 MiB");
  return result;
}
function parse(value: unknown): HollanderstoresCursor {
  const raw = JSON.stringify(value);
  if (
    raw === undefined ||
    Buffer.byteLength(raw) > HOLLANDERSTORES_MAX_CURSOR_BYTES
  )
    throw new Error("Hollander Stores checkpoint absent or exceeds 32 MiB");
  const { checksum: expected, ...state } = z
    .object({ checksum: z.string() })
    .passthrough()
    .parse(value);
  const checked = checkpoint(state);
  if (expected !== checked.checksum)
    throw new Error(
      "Hollander Stores checkpoint checksum changed; retain the last validated checkpoint",
    );
  return checked;
}
export const HollanderstoresCursor = {
  initial(previousAcceptedCount: number | null = null): HollanderstoresCursor {
    return checkpoint({
      source: "hollanderstores",
      version: 1,
      scope,
      startedAt: 0,
      previousAcceptedCount,
      pages: [],
      pending: null,
      decoded: {},
      requests: 0,
      phase: "opening",
    });
  },
  checkpoint,
  parse,
  fromWire(raw: string): HollanderstoresCursor {
    if (Buffer.byteLength(raw) > HOLLANDERSTORES_MAX_CURSOR_BYTES)
      throw new Error("Hollander Stores wire checkpoint exceeds 32 MiB");
    return parse(JSON.parse(raw));
  },
  serialize(cursor: HollanderstoresCursor): string {
    return JSON.stringify(parse(cursor));
  },
} as const;
