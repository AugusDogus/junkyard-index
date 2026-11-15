import { z } from "zod";
import {
  LonestarimportsPageSchema,
  lonestarimportsHash,
  parseLonestarimportsDocument,
  parseLonestarimportsPage,
  type LonestarimportsPage,
} from "./lonestarimports-parser";
import {
  LONESTARIMPORTS_DOCUMENTS,
  LONESTARIMPORTS_MAX_BODY_BYTES,
  LONESTARIMPORTS_MAX_CURSOR_BYTES,
  LONESTARIMPORTS_MAX_PAGES,
  LONESTARIMPORTS_MAX_REQUESTS,
  LONESTARIMPORTS_MAX_TOTAL_BYTES,
  LONESTARIMPORTS_MINIMUM_INVENTORY,
  LONESTARIMPORTS_ORIGIN,
  LONESTARIMPORTS_YARD,
  lonestarimportsPageUrl,
} from "./lonestarimports-yard-metadata";

const scope = lonestarimportsHash([
  LONESTARIMPORTS_YARD,
  LONESTARIMPORTS_DOCUMENTS,
  LONESTARIMPORTS_MINIMUM_INVENTORY,
  "complete-unfiltered20row-double-census-v1",
]);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const proofs = z.tuple([digest, digest, digest, digest]);
const pages = z
  .array(LonestarimportsPageSchema)
  .min(1)
  .max(LONESTARIMPORTS_MAX_PAGES);
const common = {
  source: z.literal("lonestarimports"),
  version: z.literal(1),
  scope: z.literal(scope),
  previousAcceptedCount: z.number().int().nonnegative().nullable(),
  requests: z.number().int().nonnegative().max(LONESTARIMPORTS_MAX_REQUESTS),
  bytes: z.number().int().nonnegative().max(LONESTARIMPORTS_MAX_TOTAL_BYTES),
};
const stateSchema = z.discriminatedUnion("phase", [
  z
    .object({
      ...common,
      phase: z.literal("opening-documents"),
      proofs: z.array(digest).max(3),
    })
    .strict(),
  z
    .object({
      ...common,
      phase: z.literal("opening-pages"),
      proofs,
      pages: z
        .array(LonestarimportsPageSchema)
        .max(LONESTARIMPORTS_MAX_PAGES - 1),
    })
    .strict(),
  z
    .object({
      ...common,
      phase: z.literal("closing-pages"),
      proofs,
      pages,
      nextPage: z.number().int().min(1).max(LONESTARIMPORTS_MAX_PAGES),
    })
    .strict(),
  z
    .object({
      ...common,
      phase: z.literal("closing-documents"),
      proofs,
      pages,
      nextDocument: z.number().int().min(0).max(3),
    })
    .strict(),
  z.object({ ...common, phase: z.literal("ready"), proofs, pages }).strict(),
  z
    .object({
      ...common,
      phase: z.literal("complete"),
      totalPages: z.number().int().min(1).max(LONESTARIMPORTS_MAX_PAGES),
    })
    .strict(),
]);
type State = z.infer<typeof stateSchema>;
export type LonestarimportsCursor = State & { checksum: string };
const base = (state: LonestarimportsCursor) => ({
  source: state.source,
  version: state.version,
  scope: state.scope,
  previousAcceptedCount: state.previousAcceptedCount,
  requests: state.requests,
  bytes: state.bytes,
});
function validatePages(
  values: readonly LonestarimportsPage[],
  complete: boolean,
): void {
  const first = values[0];
  if (!first) {
    if (complete)
      throw new Error("Lonestar checkpoint lacks its complete native catalog");
    return;
  }
  for (const [index, page] of values.entries()) {
    if (
      page.pagination.page !== index + 1 ||
      page.pagination.total !== first.pagination.total ||
      page.pagination.totalPages !== first.pagination.totalPages ||
      (!complete && !page.pagination.hasMore)
    )
      throw new Error(
        "Lonestar checkpoint skips/repeats native pages or changes the published total",
      );
  }
  if (
    complete &&
    (values.length !== first.pagination.totalPages ||
      values.at(-1)?.pagination.hasMore !== false ||
      values.reduce((sum, value) => sum + value.data.length, 0) !==
        first.pagination.total)
  )
    throw new Error(
      "Lonestar checkpoint lacks an actual complete terminal page/count proof",
    );
}
function checkpoint(
  value: unknown,
  previousAcceptedCount?: number | null,
): LonestarimportsCursor {
  const state = stateSchema.parse(value);
  let expected: number;
  switch (state.phase) {
    case "opening-documents":
      expected = state.proofs.length;
      break;
    case "opening-pages":
      validatePages(state.pages, false);
      expected = 4 + state.pages.length;
      break;
    case "closing-pages":
      validatePages(state.pages, true);
      if (state.nextPage > state.pages.length)
        throw new Error(
          "Lonestar closing checkpoint exceeds the actual native page graph",
        );
      expected = 4 + state.pages.length + state.nextPage - 1;
      break;
    case "closing-documents":
      validatePages(state.pages, true);
      expected = 4 + 2 * state.pages.length + state.nextDocument;
      break;
    case "ready":
      validatePages(state.pages, true);
      expected = 8 + 2 * state.pages.length;
      break;
    case "complete":
      expected = 8 + 2 * state.totalPages;
      break;
  }
  if (
    state.requests !== expected ||
    (previousAcceptedCount !== undefined &&
      state.previousAcceptedCount !== previousAcceptedCount) ||
    (state.requests === 0
      ? state.bytes !== 0
      : state.bytes < state.requests ||
        state.bytes > state.requests * LONESTARIMPORTS_MAX_BODY_BYTES)
  )
    throw new Error(
      "Lonestar checkpoint lost cumulative accounting, native traversal position or prior-count binding",
    );
  const result = { ...state, checksum: lonestarimportsHash(state) };
  if (
    Buffer.byteLength(JSON.stringify(result)) > LONESTARIMPORTS_MAX_CURSOR_BYTES
  )
    throw new Error("Lonestar checkpoint exceeds16 MiB");
  return result;
}
function parse(
  value: unknown,
  previousAcceptedCount?: number | null,
): LonestarimportsCursor {
  const raw = JSON.stringify(value);
  if (
    raw === undefined ||
    Buffer.byteLength(raw) > LONESTARIMPORTS_MAX_CURSOR_BYTES
  )
    throw new Error("Lonestar checkpoint is absent or exceeds16 MiB");
  const wrapper = z.object({ checksum: digest }).passthrough().parse(value);
  const { checksum, ...state } = wrapper;
  const checked = checkpoint(state, previousAcceptedCount);
  if (checksum !== checked.checksum)
    throw new Error(
      "Lonestar checkpoint checksum changed; preserve the last validated checkpoint",
    );
  return checked;
}
export function lonestarimportsNextUrl(cursor: LonestarimportsCursor): string {
  switch (cursor.phase) {
    case "opening-documents":
      return (
        LONESTARIMPORTS_ORIGIN + LONESTARIMPORTS_DOCUMENTS[cursor.proofs.length]
      );
    case "opening-pages":
      return lonestarimportsPageUrl(cursor.pages.length + 1);
    case "closing-pages":
      return lonestarimportsPageUrl(cursor.nextPage);
    case "closing-documents":
      return (
        LONESTARIMPORTS_ORIGIN +
        LONESTARIMPORTS_DOCUMENTS[3 - cursor.nextDocument]
      );
    default:
      throw new Error(
        "Lonestar ready/complete checkpoints have no next native request",
      );
  }
}
export function lonestarimportsAdvance(
  cursor: LonestarimportsCursor,
  raw: string,
): LonestarimportsCursor {
  const bytes = Buffer.byteLength(raw);
  if (
    !bytes ||
    bytes > LONESTARIMPORTS_MAX_BODY_BYTES ||
    cursor.requests >= LONESTARIMPORTS_MAX_REQUESTS
  )
    throw new Error("Lonestar physical response/request bound exceeded");
  const next = {
    ...base(cursor),
    requests: cursor.requests + 1,
    bytes: cursor.bytes + bytes,
  };
  switch (cursor.phase) {
    case "opening-documents": {
      const updated = [
        ...cursor.proofs,
        parseLonestarimportsDocument(raw, cursor.proofs.length),
      ];
      return checkpoint(
        updated.length === 4
          ? { ...next, phase: "opening-pages", proofs: updated, pages: [] }
          : { ...next, phase: "opening-documents", proofs: updated },
      );
    }
    case "opening-pages": {
      const page = parseLonestarimportsPage(raw);
      if (page.pagination.page !== cursor.pages.length + 1)
        throw new Error("Lonestar opening returned a different native page");
      const updated = [...cursor.pages, page];
      return checkpoint(
        page.pagination.hasMore
          ? {
              ...next,
              phase: "opening-pages",
              proofs: cursor.proofs,
              pages: updated,
            }
          : {
              ...next,
              phase: "closing-pages",
              proofs: cursor.proofs,
              pages: updated,
              nextPage: 1,
            },
      );
    }
    case "closing-pages": {
      const page = parseLonestarimportsPage(raw);
      if (
        lonestarimportsHash(page) !==
        lonestarimportsHash(cursor.pages[cursor.nextPage - 1])
      )
        throw new Error(
          "Lonestar genuine closing changed native fields, identities, multiplicities, pagination or destinations",
        );
      return checkpoint(
        cursor.nextPage === cursor.pages.length
          ? {
              ...next,
              phase: "closing-documents",
              proofs: cursor.proofs,
              pages: cursor.pages,
              nextDocument: 0,
            }
          : {
              ...next,
              phase: "closing-pages",
              proofs: cursor.proofs,
              pages: cursor.pages,
              nextPage: cursor.nextPage + 1,
            },
      );
    }
    case "closing-documents": {
      const index = 3 - cursor.nextDocument;
      if (parseLonestarimportsDocument(raw, index) !== cursor.proofs[index])
        throw new Error("Lonestar actual closing owner/control graph changed");
      return checkpoint(
        cursor.nextDocument === 3
          ? {
              ...next,
              phase: "ready",
              proofs: cursor.proofs,
              pages: cursor.pages,
            }
          : {
              ...next,
              phase: "closing-documents",
              proofs: cursor.proofs,
              pages: cursor.pages,
              nextDocument: cursor.nextDocument + 1,
            },
      );
    }
    default:
      throw new Error("Lonestar cannot advance a ready/complete checkpoint");
  }
}
export const LonestarimportsCursor = {
  initial(previousAcceptedCount: number | null): LonestarimportsCursor {
    return checkpoint({
      source: "lonestarimports",
      version: 1,
      scope,
      previousAcceptedCount,
      requests: 0,
      bytes: 0,
      phase: "opening-documents",
      proofs: [],
    });
  },
  parse,
  fromWire(
    raw: string,
    previousAcceptedCount?: number | null,
  ): LonestarimportsCursor {
    if (Buffer.byteLength(raw) > LONESTARIMPORTS_MAX_CURSOR_BYTES)
      throw new Error("Lonestar serialized checkpoint exceeds16 MiB");
    return parse(JSON.parse(raw), previousAcceptedCount);
  },
  serialize(
    cursor: LonestarimportsCursor,
    previousAcceptedCount?: number | null,
  ): string {
    return JSON.stringify(parse(cursor, previousAcceptedCount));
  },
  complete(cursor: LonestarimportsCursor): LonestarimportsCursor {
    if (cursor.phase !== "ready")
      throw new Error(
        "Lonestar completion requires all actual opening and closing proofs",
      );
    return checkpoint({
      ...base(cursor),
      phase: "complete",
      totalPages: cursor.pages.length,
    });
  },
} as const;
export const LonestarimportsCursorSchema = z
  .unknown()
  .transform((value, context) => {
    try {
      return parse(value);
    } catch (cause) {
      context.addIssue({
        code: "custom",
        message: cause instanceof Error ? cause.message : String(cause),
      });
      return z.NEVER;
    }
  });
