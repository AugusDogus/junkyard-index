import { z } from "zod";
import { inventoryCheckpointFingerprint as fingerprint } from "./inventory-checkpoint-fingerprint";
import { BudgetPageSchema } from "./budget-parser";
import { BUDGET_YARD } from "./budget-yard-metadata";
export const BUDGET_MAX_CURSOR_BYTES = 8 * 1024 * 1024;
const scope = fingerprint([
  BUDGET_YARD,
  "all-native-makes-map-parity-full-make-closure-v1",
]);
const base = {
  source: z.literal("budget"),
  version: z.literal(1),
  scope: z.literal(scope),
};
const working = {
  ...base,
  pages: z.array(BudgetPageSchema).min(1).max(101),
  closed: z.number().int().min(0).max(101),
};
const schema = z.discriminatedUnion("phase", [
  z.object({ ...base, phase: z.literal("directory") }).strict(),
  z.object({ ...working, phase: z.literal("opening") }).strict(),
  z.object({ ...working, phase: z.literal("closing") }).strict(),
  z.object({ ...base, phase: z.literal("complete") }).strict(),
]);
export type BudgetCursor = z.infer<typeof schema> & { checksum: string };
function checkpoint(input: unknown): BudgetCursor {
  const envelope = z
    .object({ checksum: z.string().optional() })
    .passthrough()
    .parse(input);
  const value = Object.fromEntries(
    Object.entries(envelope).filter(([key]) => key !== "checksum"),
  );
  const state = schema.parse(value);
  if ("pages" in state) {
    const first = state.pages[0];
    if (!first || first.make !== "" || first.records.length)
      throw new Error("Budget checkpoint lacks its native opening directory");
    const count = first.makes.length + 1;
    for (const [index, p] of state.pages.entries())
      if (
        p.make !== (index === 0 ? "" : first.makes[index - 1]) ||
        p.updated !== first.updated ||
        JSON.stringify(p.makes) !== JSON.stringify(first.makes) ||
        JSON.stringify(p.models) !== JSON.stringify(first.models)
      )
        throw new Error(
          "Budget checkpoint changed directory, update date or contiguous make prefix",
        );
    if (
      state.phase === "opening"
        ? state.pages.length >= count || state.closed !== 0
        : state.pages.length !== count || state.closed >= count
    )
      throw new Error(
        "Budget checkpoint lost its complete opening/closing prefix",
      );
  }
  const cursor = { ...state, checksum: fingerprint(state) };
  if (
    new TextEncoder().encode(JSON.stringify(cursor)).length >
    BUDGET_MAX_CURSOR_BYTES
  )
    throw new Error("Budget checkpoint exceeds 8 MiB");
  return cursor;
}
function parse(input: unknown): BudgetCursor {
  const v = z.object({ checksum: z.string() }).passthrough().parse(input);
  const checked = checkpoint(v);
  if (v.checksum !== checked.checksum)
    throw new Error("Budget checkpoint checksum changed");
  return checked;
}
export const BudgetCursor = {
  initial: () =>
    checkpoint({ source: "budget", version: 1, scope, phase: "directory" }),
  checkpoint,
  parse,
  fromWire(raw: string) {
    if (new TextEncoder().encode(raw).length > BUDGET_MAX_CURSOR_BYTES)
      throw new Error("Budget checkpoint wire exceeds 8 MiB");
    return parse(JSON.parse(raw));
  },
  serialize: (cursor: BudgetCursor) => JSON.stringify(parse(cursor)),
} as const;
