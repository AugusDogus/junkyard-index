import { z } from "zod";
import { HollanderstoresPageSchema } from "./hollanderstores-parser";
import { HOLLANDERSTORES_YARDS } from "./hollanderstores-yard-metadata";
import { hollanderstoresVin } from "./hollanderstores-vin";

export const HOLLANDERSTORES_MAX_CURSOR_BYTES = 2 * 1024 * 1024;
// Pure JS corruption checksum so workflow-side cursor imports need no Node modules.
function checksum(value: unknown): string {
  let hash = 2166136261;
  for (const char of JSON.stringify(value))
    hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(16).padStart(8, "0");
}
const scope = checksum([
  HOLLANDERSTORES_YARDS,
  "card/blank-make-vpic/check-digit/double-census-v1",
]);
const common = {
  source: z.literal("hollanderstores"),
  version: z.literal(1),
  scope: z.literal(scope),
  startedAt: z.number().int().nonnegative(),
  previousAcceptedCount: z.number().int().nonnegative().nullable(),
  pages: z.array(HollanderstoresPageSchema).max(5),
  decoded: z.record(
    z.string().regex(/^[A-HJ-NPR-Z0-9]{17}$/),
    z.string().trim().min(1).max(100).nullable(),
  ),
  requests: z.number().int().nonnegative().max(210),
};
const schema = z.discriminatedUnion("phase", [
  z.object({ ...common, phase: z.literal("opening") }).strict(),
  z.object({ ...common, phase: z.literal("decoding") }).strict(),
  z
    .object({
      ...common,
      phase: z.literal("closing"),
      closed: z.number().int().min(0).max(4),
    })
    .strict(),
  z
    .object({ ...common, phase: z.literal("ready"), closed: z.literal(5) })
    .strict(),
  z
    .object({ ...common, phase: z.literal("complete"), closed: z.literal(5) })
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
        page.rows
          .filter((row) => !row.make?.trim() && hollanderstoresVin(row.vin))
          .map((row) => row.vin),
      ),
    ),
  ];
}
function checkpoint(value: unknown): HollanderstoresCursor {
  const state = schema.parse(value);
  const needed = hollanderstoresMissing(state),
    decoded = Object.keys(state.decoded);
  const closed = "closed" in state ? state.closed : 0;
  if (
    (state.requests === 0 ? state.startedAt !== 0 : state.startedAt <= 0) ||
    state.pages.some(
      (page, index) => page.yard !== HOLLANDERSTORES_YARDS[index]?.code,
    ) ||
    (state.phase === "opening"
      ? state.pages.length >= 5 || decoded.length !== 0
      : state.pages.length !== 5) ||
    decoded.some((vin, index) => vin !== needed[index]) ||
    (decoded.length !== needed.length && decoded.length % 50 !== 0) ||
    (state.phase !== "opening" &&
      state.phase !== "decoding" &&
      decoded.length !== needed.length) ||
    (state.phase === "decoding" && decoded.length === needed.length) ||
    state.requests !==
      state.pages.length + Math.ceil(decoded.length / 50) + closed
  )
    throw new Error(
      "Hollander Stores checkpoint lost ordered complete yards, decode batches or closing evidence",
    );
  const result = { ...state, checksum: checksum(state) };
  if (
    Buffer.byteLength(JSON.stringify(result)) > HOLLANDERSTORES_MAX_CURSOR_BYTES
  )
    throw new Error("Hollander Stores checkpoint exceeds 2 MiB");
  return result;
}
function parse(value: unknown): HollanderstoresCursor {
  const raw = JSON.stringify(value);
  if (
    raw === undefined ||
    Buffer.byteLength(raw) > HOLLANDERSTORES_MAX_CURSOR_BYTES
  )
    throw new Error("Hollander Stores checkpoint absent or exceeds 2 MiB");
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
      decoded: {},
      requests: 0,
      phase: "opening",
    });
  },
  checkpoint,
  parse,
  fromWire(raw: string): HollanderstoresCursor {
    if (Buffer.byteLength(raw) > HOLLANDERSTORES_MAX_CURSOR_BYTES)
      throw new Error("Hollander Stores wire checkpoint exceeds 2 MiB");
    return parse(JSON.parse(raw));
  },
  serialize(cursor: HollanderstoresCursor): string {
    return JSON.stringify(parse(cursor));
  },
} as const;
