import { z } from "zod";
import {
  WeberbrothersCatalogSchema,
  WeberbrothersRecordSchema,
  WEBERBROTHERS_MAX_DONORS,
  WEBERBROTHERS_MAX_PAGES,
  weberbrothersCatalogMembership,
  weberbrothersHash,
} from "./weberbrothers-parser";
import {
  inspectWeberbrothersSnapshot,
  validateWeberbrothersSnapshot,
} from "./weberbrothers-snapshot";
import {
  WEBERBROTHERS_CATALOG,
  WEBERBROTHERS_YARD,
} from "./weberbrothers-yard-metadata";

export const WEBERBROTHERS_MAX_CURSOR_BYTES = 8 * 1024 * 1024;
export const WEBERBROTHERS_MAX_RUN_BYTES = 4 * 1024 * 1024 * 1024;
export const WEBERBROTHERS_MAX_RUN_REQUESTS =
  WEBERBROTHERS_MAX_DONORS + WEBERBROTHERS_MAX_PAGES * 2;
export const WEBERBROTHERS_CURSOR_SCOPE = weberbrothersHash({
  version: 1,
  yard: WEBERBROTHERS_YARD,
  root: WEBERBROTHERS_CATALOG,
  contract:
    "native-post-id-and-literal-ordered-vehicle-members/all-details/all-closing/no-identity-repair-v1",
});
const common = {
  source: z.literal("weberbrothers"),
  version: z.literal(1),
  scope: z.literal(WEBERBROTHERS_CURSOR_SCOPE),
  checksum: z.string().regex(/^[a-f0-9]{64}$/),
  pages: z.array(WeberbrothersCatalogSchema).max(WEBERBROTHERS_MAX_PAGES),
  records: z.array(WeberbrothersRecordSchema).max(WEBERBROTHERS_MAX_DONORS),
  closing: z.array(WeberbrothersCatalogSchema).max(WEBERBROTHERS_MAX_PAGES),
};
const stateSchema = z.discriminatedUnion("phase", [
  z.object({ ...common, phase: z.literal("catalog") }).strict(),
  z.object({ ...common, phase: z.literal("details") }).strict(),
  z.object({ ...common, phase: z.literal("closing") }).strict(),
  z.object({ ...common, phase: z.literal("complete") }).strict(),
]);
export type WeberbrothersState = z.infer<typeof stateSchema>;
function checksum(state: Omit<WeberbrothersState, "checksum">) {
  return weberbrothersHash({
    source: state.source,
    version: state.version,
    scope: state.scope,
    phase: state.phase,
    pages: state.pages,
    records: state.records,
    closing: state.closing,
  });
}
const wire = (state: WeberbrothersState) =>
  JSON.stringify(
    Object.fromEntries(
      Object.entries(state).filter(([key]) => key !== "source"),
    ),
  );

/** Checksum detects damaged trusted checkpoints, not authentication of input.
 * Recompute every native prefix and whole-source conflict group on resume. */
export function inspectWeberbrothersCursor(state: WeberbrothersState) {
  const posts = state.pages.flatMap((page) => page.posts);
  const lastPage = state.pages[0]?.lastPage ?? 0;
  if (
    state.pages.some(
      (page, index) =>
        page.page !== index + 1 ||
        page.lastPage !== lastPage ||
        page.url !==
          (index === 0 ? WEBERBROTHERS_CATALOG : state.pages[index - 1]?.next),
    ) ||
    new Set(posts.map((post) => post.url)).size !== posts.length ||
    new Set(posts.map((post) => post.nativePostId)).size !== posts.length
  )
    throw new Error(
      "Weber checkpoint listing prefix or unique native donor membership changed",
    );
  const aliases = new Map<number, string>();
  for (const page of state.pages)
    for (const link of page.links) {
      const prior = aliases.get(link.page);
      if (prior && prior !== link.url)
        throw new Error("Weber native page destinations conflict");
      aliases.set(link.page, link.url);
    }
  for (const [index, record] of state.records.entries()) {
    if (
      JSON.stringify(record.post) !== JSON.stringify(posts[index]) ||
      record.heading !== record.post.title ||
      (record.post.stock && record.stock !== record.post.stock)
    )
      throw new Error(
        "Weber checkpoint donor native ID, order, heading or stock changed",
      );
  }
  const phase = ["catalog", "details", "closing", "complete"].indexOf(
    state.phase,
  );
  const lengths = [
    state.pages.length,
    state.records.length,
    state.closing.length,
  ];
  const totals = [lastPage, posts.length, lastPage];
  for (const [index, length] of lengths.entries()) {
    const total = totals[index] ?? 0;
    const valid =
      index < phase
        ? length === total && total > 0
        : index === phase
          ? length < total || (state.phase === "catalog" && length === 0)
          : length === 0;
    if (!valid)
      throw new Error(
        "Weber checkpoint is not a contiguous complete traversal prefix",
      );
  }
  for (const [index, page] of state.closing.entries()) {
    const opening = state.pages[index];
    if (
      !opening ||
      JSON.stringify(weberbrothersCatalogMembership(page)) !==
        JSON.stringify(weberbrothersCatalogMembership(opening))
    )
      throw new Error(
        "Weber closing membership, labels or pagination changed during traversal",
      );
  }
  const receipts = [...state.pages, ...state.records, ...state.closing].map(
    (value) => value.receipt,
  );
  const bytes = receipts.reduce((sum, receipt) => sum + receipt.bytes, 0);
  if (
    receipts.length > WEBERBROTHERS_MAX_RUN_REQUESTS ||
    bytes > WEBERBROTHERS_MAX_RUN_BYTES
  )
    throw new Error("Weber run exceeded its bounded request or byte capacity");
  const snapshot = inspectWeberbrothersSnapshot(state.records);
  if (state.phase === "closing" || state.phase === "complete")
    validateWeberbrothersSnapshot(snapshot, {
      minimumUniqueInventory: 1,
      previousUniqueInventory: null,
    });
  return { posts, snapshot, requests: receipts.length, bytes };
}
export const WeberbrothersCursorSchema = stateSchema.superRefine(
  (state, context) => {
    try {
      if (state.checksum !== checksum(state))
        throw new Error("Weber checkpoint checksum changed");
      if (Buffer.byteLength(wire(state)) > WEBERBROTHERS_MAX_CURSOR_BYTES)
        throw new Error(
          "Weber checkpoint exceeds 8 MiB; inspect source growth before resuming",
        );
      inspectWeberbrothersCursor(state);
    } catch (cause) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          cause instanceof Error ? cause.message : "Invalid Weber checkpoint",
      });
    }
  },
);
export type WeberbrothersCursor = z.infer<typeof WeberbrothersCursorSchema>;
function checkpoint(
  state: Omit<WeberbrothersState, "checksum">,
): WeberbrothersCursor {
  return WeberbrothersCursorSchema.parse({
    ...state,
    checksum: checksum(state),
  });
}
export const WeberbrothersCursor = {
  initial: checkpoint({
    source: "weberbrothers",
    version: 1,
    scope: WEBERBROTHERS_CURSOR_SCOPE,
    phase: "catalog",
    pages: [],
    records: [],
    closing: [],
  }),
  checkpoint,
  parse(value: string): WeberbrothersCursor {
    if (Buffer.byteLength(value) > WEBERBROTHERS_MAX_CURSOR_BYTES)
      throw new Error(
        "Weber serialized checkpoint exceeds 8 MiB; retain the prior checkpoint",
      );
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
      throw new Error("Expected a Weber checkpoint object");
    return WeberbrothersCursorSchema.parse({
      ...parsed,
      source: "weberbrothers",
    });
  },
  serialize(value: WeberbrothersCursor): string {
    return wire(WeberbrothersCursorSchema.parse(value));
  },
} as const;
