import { z } from "zod";
import { heavyTruckPartsHash } from "./heavytruckparts-html";
import {
  CstruckPageSchema,
  parseCstruckPage,
  parseCstruckStore,
  type CstruckPage,
} from "./cstruck-parser";
import { cstruckSnapshot } from "./cstruck-snapshot";
import {
  CSTRUCK_MAX_BYTES,
  CSTRUCK_MAX_CURSOR_BYTES,
  CSTRUCK_MAX_REQUESTS,
  CSTRUCK_RANGES,
  CSTRUCK_STORE,
  CSTRUCK_YARD,
  cstruckRangeUrl,
  type CstruckRange,
} from "./cstruck-yard-metadata";

const scope = heavyTruckPartsHash([
  CSTRUCK_YARD,
  CSTRUCK_RANGES,
  "salvage-yard-complete-vehicle-policy-v1-double-range-census",
]);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const common = {
  source: z.literal("cstruck"),
  version: z.literal(1),
  scope: z.literal(scope),
  requests: z.number().int().min(0).max(CSTRUCK_MAX_REQUESTS),
  bytes: z
    .number()
    .int()
    .min(0)
    .max(CSTRUCK_MAX_REQUESTS * CSTRUCK_MAX_BYTES),
  startedAt: z.number().int().nonnegative(),
  previousAcceptedCount: z.number().int().nonnegative().nullable(),
};
const census = {
  total: z.number().int().min(1).max(375),
  pages: z.array(CstruckPageSchema).max(15),
};
const schema = z.discriminatedUnion("phase", [
  z.object({ ...common, phase: z.literal("store-opening") }).strict(),
  z.object({ ...common, ...census, phase: z.literal("opening") }).strict(),
  z
    .object({
      ...common,
      ...census,
      phase: z.literal("closing"),
      nextPage: z.number().int().min(0).max(14),
    })
    .strict(),
  z
    .object({ ...common, ...census, phase: z.literal("store-closing") })
    .strict(),
  z.object({ ...common, ...census, phase: z.literal("ready") }).strict(),
  z.object({ ...common, ...census, phase: z.literal("complete") }).strict(),
]);
type State = z.infer<typeof schema>;
export type CstruckCursor = State & { checksum: string };
/** Reconstruct the exact frontier from every response, including capped parent
 * ranges. No serialized queue can skip a year or pretend a capped page is done. */
export function cstruckFrontier(pages: readonly CstruckPage[]): CstruckRange[] {
  const pending: CstruckRange[] = [...CSTRUCK_RANGES];
  for (const page of pages) {
    const expected = pending.shift();
    if (
      !expected ||
      heavyTruckPartsHash(page.range) !== heavyTruckPartsHash(expected) ||
      page.range[0] > page.range[1] ||
      page.capped !== (page.records.length === 25) ||
      (page.hasMore && !page.capped) ||
      new Set(page.records.map((r) => r.id)).size !== page.records.length ||
      page.records.some(
        (r) =>
          Number(r.year) < page.range[0] ||
          Number(r.year) > page.range[1] ||
          (r.description !== "CAB & CHASSIS" &&
            !(r.make === "TRAILER" && r.description === "FLATBED")),
      )
    )
      throw new Error(
        "C&S checkpoint lost its exact range frontier or native page controls",
      );
    if (page.capped) {
      if (expected[0] === expected[1])
        throw new Error(
          "C&S single year hits the 25-row cap; retain prior inventory and review enumeration",
        );
      const middle = Math.floor((expected[0] + expected[1]) / 2);
      pending.unshift([expected[0], middle], [middle + 1, expected[1]]);
    }
  }
  return pending;
}
export function cstruckRoster(pages: readonly CstruckPage[], total: number) {
  if (cstruckFrontier(pages).length)
    throw new Error("C&S census still has unvisited year ranges");
  const records = pages.filter((p) => !p.capped).flatMap((p) => p.records);
  if (
    records.length !== total ||
    new Set(records.map((r) => r.id)).size !== total
  )
    throw new Error(
      "C&S complete enumeration does not reconcile to the independent store count",
    );
  return records;
}
function checkpoint(
  input: unknown,
  previousAcceptedCount?: number | null,
): CstruckCursor {
  const state = schema.parse(input);
  let expected = 0;
  if (state.phase !== "store-opening") {
    const frontier = cstruckFrontier(state.pages);
    if (state.phase === "opening") {
      if (!frontier.length)
        throw new Error(
          "C&S opening checkpoint already exhausted its frontier",
        );
      expected = 1 + state.pages.length;
    } else {
      const records = cstruckRoster(state.pages, state.total);
      cstruckSnapshot(records, state.previousAcceptedCount);
      if (state.phase === "closing" && state.nextPage >= state.pages.length)
        throw new Error(
          "C&S closing checkpoint exceeds its actual opening graph",
        );
      expected =
        1 +
        state.pages.length +
        (state.phase === "closing" ? state.nextPage : state.pages.length);
      if (state.phase === "ready" || state.phase === "complete") expected++;
    }
  }
  if (
    state.requests !== expected ||
    (state.requests
      ? state.bytes < state.requests ||
        state.bytes > state.requests * CSTRUCK_MAX_BYTES
      : state.bytes !== 0) ||
    (previousAcceptedCount !== undefined &&
      state.previousAcceptedCount !== previousAcceptedCount)
  )
    throw new Error(
      "C&S checkpoint lost request accounting or prior-count binding",
    );
  const result = { ...state, checksum: heavyTruckPartsHash(state) };
  if (Buffer.byteLength(JSON.stringify(result)) > CSTRUCK_MAX_CURSOR_BYTES)
    throw new Error("C&S checkpoint exceeds 4 MiB");
  return result;
}
function parse(
  input: unknown,
  previousAcceptedCount?: number | null,
): CstruckCursor {
  const raw = JSON.stringify(input);
  if (raw === undefined || Buffer.byteLength(raw) > CSTRUCK_MAX_CURSOR_BYTES)
    throw new Error("C&S checkpoint is absent or exceeds 4 MiB");
  const { checksum, ...state } = z
    .object({ checksum: digest })
    .passthrough()
    .parse(input);
  const checked = checkpoint(state, previousAcceptedCount);
  if (checksum !== checked.checksum)
    throw new Error(
      "C&S checkpoint checksum changed; retain the last validated checkpoint",
    );
  return checked;
}
export function cstruckNextUrl(cursor: CstruckCursor): string {
  if (cursor.phase === "store-opening" || cursor.phase === "store-closing")
    return CSTRUCK_STORE;
  if (cursor.phase === "opening") {
    const next = cstruckFrontier(cursor.pages)[0];
    if (next) return cstruckRangeUrl(next);
  }
  if (cursor.phase === "closing") {
    const next = cursor.pages[cursor.nextPage];
    if (next) return cstruckRangeUrl(next.range);
  }
  throw new Error("C&S checkpoint has no next native request");
}
export function cstruckAdvance(
  cursor: CstruckCursor,
  raw: string,
): CstruckCursor {
  const bytes = Buffer.byteLength(raw);
  if (
    !bytes ||
    bytes > CSTRUCK_MAX_BYTES ||
    cursor.requests >= CSTRUCK_MAX_REQUESTS
  )
    throw new Error("C&S physical response or 32-request bound exceeded");
  const { checksum: _checksum, ...state } = cursor;
  void _checksum;
  const next = {
    ...state,
    requests: cursor.requests + 1,
    bytes: cursor.bytes + bytes,
    startedAt: cursor.startedAt || Date.now(),
  };
  switch (cursor.phase) {
    case "store-opening":
      return checkpoint({
        ...next,
        phase: "opening",
        total: parseCstruckStore(raw),
        pages: [],
      });
    case "opening": {
      const range = cstruckFrontier(cursor.pages)[0];
      if (!range) throw new Error("C&S opening frontier is exhausted");
      const pages = [...cursor.pages, parseCstruckPage(raw, range)];
      return checkpoint(
        cstruckFrontier(pages).length
          ? { ...next, phase: "opening", total: cursor.total, pages }
          : {
              ...next,
              phase: "closing",
              total: cursor.total,
              pages,
              nextPage: 0,
            },
      );
    }
    case "closing": {
      const prior = cursor.pages[cursor.nextPage];
      if (
        !prior ||
        heavyTruckPartsHash(parseCstruckPage(raw, prior.range)) !==
          heavyTruckPartsHash(prior)
      )
        throw new Error(
          "C&S closing changed native identity, membership, metadata or pagination; no vehicles emitted",
        );
      const { nextPage: _index, checksum: _prior, ...current } = cursor;
      const rest = {
        ...current,
        requests: next.requests,
        bytes: next.bytes,
        startedAt: next.startedAt,
      };
      void _prior;
      void _index;
      return checkpoint(
        cursor.nextPage + 1 === cursor.pages.length
          ? { ...rest, phase: "store-closing" }
          : { ...rest, phase: "closing", nextPage: cursor.nextPage + 1 },
      );
    }
    case "store-closing":
      if (parseCstruckStore(raw) !== cursor.total)
        throw new Error("C&S independent store count changed during census");
      return checkpoint({ ...next, phase: "ready" });
    default:
      throw new Error(
        "C&S ready/complete checkpoints cannot request more pages",
      );
  }
}
export const CstruckCursor = {
  initial: (previousAcceptedCount: number | null = null): CstruckCursor =>
    checkpoint({
      source: "cstruck",
      version: 1,
      scope,
      requests: 0,
      bytes: 0,
      startedAt: 0,
      previousAcceptedCount,
      phase: "store-opening",
    }),
  checkpoint,
  parse,
  fromWire(raw: string): CstruckCursor {
    if (Buffer.byteLength(raw) > CSTRUCK_MAX_CURSOR_BYTES)
      throw new Error("C&S serialized checkpoint exceeds 4 MiB");
    const value: unknown = JSON.parse(raw);
    return parse(value);
  },
  serialize: (cursor: CstruckCursor) => JSON.stringify(parse(cursor)),
  complete(cursor: CstruckCursor): CstruckCursor {
    if (cursor.phase !== "ready")
      throw new Error(
        "C&S completion requires actual opening and closing proofs",
      );
    const { checksum: _checksum, ...state } = cursor;
    void _checksum;
    return checkpoint({ ...state, phase: "complete" });
  },
} as const;
