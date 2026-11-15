import { z } from "zod";
import { dutchersHash } from "./dutchers-html";
import { DutchersPageSchema, type DutchersPage } from "./dutchers-parser";
import { DutchersScopeSchema } from "./dutchers-scope";
import { dutchersRoster, dutchersSnapshot } from "./dutchers-snapshot";
import {
  DUTCHERS_MAX_PAGES,
  DUTCHERS_PAGE_SIZE,
  DUTCHERS_SCOPE,
  DUTCHERS_STORE,
  DUTCHERS_YARD,
} from "./dutchers-yard-metadata";

const scopeKey = dutchersHash({
  version: 1,
  yard: DUTCHERS_YARD,
  native: DUTCHERS_SCOPE,
  store: DUTCHERS_STORE,
  protocol: "year-desc-asc-open-close-scope-quarantine",
});
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const base = {
  source: z.literal("dutchers"),
  version: z.literal(1),
  scopeKey: z.literal(scopeKey),
  startedAt: z.number().int().min(0),
};
const owned = { ...base, scope: DutchersScopeSchema };
const roster = {
  ...owned,
  total: z
    .number()
    .int()
    .min(1)
    .max(DUTCHERS_MAX_PAGES * DUTCHERS_PAGE_SIZE),
};
const pages = z.array(DutchersPageSchema).max(DUTCHERS_MAX_PAGES * 2);
const closed = { ...roster, opening: pages, closing: pages };
const schema = z.discriminatedUnion("phase", [
  z.object({ ...base, phase: z.literal("scope-opening") }).strict(),
  z.object({ ...owned, phase: z.literal("store-opening") }).strict(),
  z.object({ ...roster, phase: z.literal("opening"), pages }).strict(),
  z
    .object({ ...roster, phase: z.literal("closing"), opening: pages, pages })
    .strict(),
  z.object({ ...closed, phase: z.literal("store-closing") }).strict(),
  z.object({ ...closed, phase: z.literal("scope-closing") }).strict(),
  z.object({ ...base, phase: z.literal("complete") }).strict(),
]);
export type DutchersState = z.infer<typeof schema>;
export type DutchersCursor = DutchersState & { checksum: string };

export function dutchersPageControl(total: number, index: number) {
  const size = Math.ceil(total / DUTCHERS_PAGE_SIZE);
  if (!Number.isSafeInteger(index) || index < 0 || index >= size * 2)
    throw new Error("Dutcher checkpoint has no next native catalog control");
  return {
    direction: index < size ? ("DESC" as const) : ("ASC" as const),
    page: (index % size) + 1,
  };
}
function prefix(values: readonly DutchersPage[], total: number) {
  const size = Math.ceil(total / DUTCHERS_PAGE_SIZE);
  if (
    values.length >= size * 2 ||
    values.some((p, i) => {
      const expected = dutchersPageControl(total, i);
      return (
        p.direction !== expected.direction ||
        p.page !== expected.page ||
        p.records.length !==
          Math.min(
            DUTCHERS_PAGE_SIZE,
            total - (p.page - 1) * DUTCHERS_PAGE_SIZE,
          )
      );
    })
  )
    throw new Error(
      "Dutcher checkpoint lost its exact ordered dual-sort page prefix",
    );
}
function checkpoint(input: DutchersState): DutchersCursor {
  const { checksum: _prior, ...rest } = z
    .object({ checksum: hash.optional() })
    .passthrough()
    .parse(input);
  void _prior;
  const state = schema.parse(rest);
  if (state.phase === "opening") prefix(state.pages, state.total);
  if (state.phase === "closing") prefix(state.pages, state.total);
  if (
    state.phase === "closing" ||
    state.phase === "store-closing" ||
    state.phase === "scope-closing"
  ) {
    const opening = dutchersRoster(state.opening, state.total);
    dutchersSnapshot(opening, state.scope);
    if (state.phase !== "closing") {
      const closing = dutchersRoster(state.closing, state.total);
      if (dutchersHash(opening) !== dutchersHash(closing))
        throw new Error(
          "Dutcher closing roster changed item membership or native metadata; no vehicles emitted",
        );
    }
  }
  return { ...state, checksum: dutchersHash(state) };
}
export const DutchersCursor = {
  initial: (): DutchersCursor =>
    checkpoint({
      source: "dutchers",
      version: 1,
      scopeKey,
      startedAt: 0,
      phase: "scope-opening",
    }),
  checkpoint,
  parse(input: unknown): DutchersCursor {
    if (Buffer.byteLength(JSON.stringify(input) ?? "") > 8 * 1024 * 1024)
      throw new Error("Dutcher checkpoint exceeds 8 MiB");
    const { checksum, ...rest } = z
      .object({ checksum: hash })
      .passthrough()
      .parse(input);
    const cursor = checkpoint(schema.parse(rest));
    if (checksum !== cursor.checksum)
      throw new Error(
        "Dutcher checkpoint checksum changed; preserve the last validated checkpoint",
      );
    return cursor;
  },
} as const;
export const DutchersCursorSchema = z
  .unknown()
  .transform((input, context): DutchersCursor => {
    try {
      return DutchersCursor.parse(input);
    } catch (cause) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          cause instanceof Error ? cause.message : "Invalid Dutcher checkpoint",
      });
      return z.NEVER;
    }
  });
