import { z } from "zod";
import { inventoryCheckpointFingerprint as fingerprint } from "./inventory-checkpoint-fingerprint";
import { HarrysPageSchema } from "./harrys-parser";
import {
  HARRYS_YARDS,
  HARRYS_MAX_PAGES,
  HARRYS_PAGE_SIZE,
} from "./harrys-yard-metadata";
export const HARRYS_MAX_CURSOR_BYTES = 8 * 1024 * 1024;
const scope = fingerprint([
  HARRYS_YARDS,
  "native-15-row-two-census-identity-closure-v1",
]);
const base = {
  source: z.literal("harrys"),
  version: z.literal(1),
  scope: z.literal(scope),
};
const working = {
  ...base,
  pages: z.array(HarrysPageSchema).max(HARRYS_MAX_PAGES),
  closed: z.number().int().min(0).max(HARRYS_MAX_PAGES),
};
const schema = z.discriminatedUnion("phase", [
  z.object({ ...base, phase: z.literal("owner") }).strict(),
  z.object({ ...working, phase: z.literal("opening") }).strict(),
  z.object({ ...working, phase: z.literal("closing") }).strict(),
  z.object({ ...working, phase: z.literal("owner-closing") }).strict(),
  z.object({ ...base, phase: z.literal("complete") }).strict(),
]);
export type HarrysState = z.infer<typeof schema>;
export type HarrysCursor = HarrysState & { checksum: string };
function checkpoint(input: unknown): HarrysCursor {
  const envelope = z
    .object({ checksum: z.string().optional() })
    .passthrough()
    .parse(input);
  const value = Object.fromEntries(
    Object.entries(envelope).filter(([key]) => key !== "checksum"),
  );
  const state = schema.parse(value);
  if ("pages" in state) {
    const total = state.pages[0]?.total ?? 0;
    const count = Math.ceil(total / HARRYS_PAGE_SIZE);
    if (
      state.pages.some(
        (p, i) =>
          p.index !== i ||
          p.total !== total ||
          p.records.length !==
            Math.min(HARRYS_PAGE_SIZE, total - i * HARRYS_PAGE_SIZE),
      ) ||
      (state.phase === "opening"
        ? state.pages.length >= count && count > 0
        : !count || state.pages.length !== count) ||
      state.closed > state.pages.length ||
      (state.phase === "opening" && state.closed !== 0) ||
      (state.phase === "closing" && state.closed >= count) ||
      (state.phase === "owner-closing" && state.closed !== count)
    )
      throw new Error("Harry's checkpoint lost its exact native census prefix");
    const ids = state.pages.flatMap((p) => p.records.map((r) => r.id));
    if (new Set(ids).size !== ids.length)
      throw new Error("Harry's native donor ID repeats across pages");
  }
  const cursor = { ...state, checksum: fingerprint(state) };
  if (
    new TextEncoder().encode(JSON.stringify(cursor)).length >
    HARRYS_MAX_CURSOR_BYTES
  )
    throw new Error("Harry's checkpoint exceeds 8 MiB");
  return cursor;
}
function parse(input: unknown): HarrysCursor {
  const value = z.object({ checksum: z.string() }).passthrough().parse(input);
  const checked = checkpoint(value);
  if (value.checksum !== checked.checksum)
    throw new Error("Harry's checkpoint checksum changed");
  return checked;
}
export const HarrysCursor = {
  initial: () =>
    checkpoint({ source: "harrys", version: 1, scope, phase: "owner" }),
  checkpoint,
  parse,
  fromWire(raw: string) {
    if (new TextEncoder().encode(raw).length > HARRYS_MAX_CURSOR_BYTES)
      throw new Error("Harry's checkpoint wire exceeds 8 MiB");
    return parse(JSON.parse(raw));
  },
  serialize: (cursor: HarrysCursor) => JSON.stringify(parse(cursor)),
} as const;
