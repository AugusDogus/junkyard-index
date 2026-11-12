import { z } from "zod";
import {
  AWAP_MAX_PAGES,
  AWAP_PAGE_SIZE,
  AwapPageSchema,
  awapHash,
  awapPageHash,
} from "./awap-parser";
import { awapSnapshot, validateAwapSnapshot } from "./awap-transform";
import { AWAP_CATALOG, AWAP_YARD, awapCatalogPage } from "./awap-yard-metadata";

export const AWAP_MAX_REQUESTS = 1 + 2 * AWAP_MAX_PAGES;
export const AWAP_MAX_CURSOR_BYTES = 2 * 1024 * 1024;
const base = { source: z.literal("awap"), version: z.literal(1) };
const progress = {
  ...base,
  scope: z.literal(
    awapHash({
      yard: AWAP_YARD,
      contract: "native-listing-claims/no-inference/all-page-closing-v1",
    }),
  ),
  checksum: z.string().regex(/^[a-f0-9]{64}$/),
  pages: z.array(AwapPageSchema).max(AWAP_MAX_PAGES),
};
const ProgressSchema = z.discriminatedUnion("phase", [
  z.object({ ...progress, phase: z.literal("catalog") }).strict(),
  z
    .object({
      ...progress,
      phase: z.literal("closing"),
      closing: z.number().int().min(0).max(AWAP_MAX_PAGES),
    })
    .strict(),
]);
export type AwapProgress = z.infer<typeof ProgressSchema>;
const checksum = (state: AwapProgress) =>
  awapHash({ ...state, checksum: null });
export const AwapCursorSchema = z
  .union([
    z.object({ ...base, phase: z.literal("identity") }).strict(),
    z.object({ ...base, phase: z.literal("complete") }).strict(),
    ProgressSchema,
  ])
  .superRefine((state, context) => {
    if (state.phase === "identity" || state.phase === "complete") return;
    try {
      if (
        Buffer.byteLength(JSON.stringify(state)) > AWAP_MAX_CURSOR_BYTES ||
        checksum(state) !== state.checksum
      )
        throw new Error("AWAP checkpoint size or integrity changed");
      const first = state.pages[0];
      if (first && first.url !== AWAP_CATALOG)
        throw new Error(
          "AWAP checkpoint does not begin at the native complete catalog",
        );
      for (const [index, page] of state.pages.entries()) {
        const terminal = page.page === Math.ceil(page.total / AWAP_PAGE_SIZE);
        if (
          page.page !== index + 1 ||
          awapCatalogPage(page.url) !== page.page ||
          page.total !== first?.total ||
          page.hash !== awapPageHash(page) ||
          (index > 0 && state.pages[index - 1]?.next !== page.url) ||
          page.records.length !==
            Math.min(AWAP_PAGE_SIZE, page.total - index * AWAP_PAGE_SIZE) ||
          (terminal
            ? page.next !== null
            : awapCatalogPage(page.next ?? "") !== page.page + 1)
        )
          throw new Error(
            "AWAP checkpoint skips native pages, contradicts counts or changes literal pagination",
          );
      }
      const last = state.pages.at(-1);
      const snapshot = awapSnapshot(
        state.pages.flatMap((page) => page.records),
      );
      if (state.phase === "catalog") {
        if (last?.next === null)
          throw new Error(
            "AWAP terminal catalog cannot remain in catalog phase",
          );
      } else {
        if (
          !first ||
          !last ||
          last.next !== null ||
          snapshot.accounting.recordsProcessed !== first.total ||
          state.closing > state.pages.length
        )
          throw new Error(
            "AWAP closing checkpoint lacks a complete native census or valid closing prefix",
          );
        validateAwapSnapshot(snapshot);
      }
    } catch (cause) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          cause instanceof Error ? cause.message : "Invalid AWAP checkpoint",
      });
    }
  });
export type AwapCursor = z.infer<typeof AwapCursorSchema>;
function checkpoint(value: unknown): AwapProgress {
  const canonical = ProgressSchema.parse(value);
  const state = AwapCursorSchema.parse({
    ...canonical,
    checksum: checksum(canonical),
  });
  if (state.phase === "identity" || state.phase === "complete")
    throw new Error("Expected resumable AWAP progress");
  return state;
}
export const AwapCursor = {
  initial: {
    source: "awap",
    version: 1,
    phase: "identity",
  } satisfies AwapCursor,
  begin: () =>
    checkpoint({
      source: "awap",
      version: 1,
      phase: "catalog",
      scope: progress.scope.value,
      checksum: "0".repeat(64),
      pages: [],
    }),
  checkpoint,
  parse(raw: string): AwapCursor {
    if (Buffer.byteLength(raw) > AWAP_MAX_CURSOR_BYTES)
      throw new Error(
        "AWAP checkpoint wire payload exceeds 2 MiB; retain the last validated checkpoint",
      );
    const value: unknown = JSON.parse(raw);
    return AwapCursorSchema.parse(value);
  },
  serialize(cursor: AwapCursor): string {
    const raw = JSON.stringify(AwapCursorSchema.parse(cursor));
    if (Buffer.byteLength(raw) > AWAP_MAX_CURSOR_BYTES)
      throw new Error(
        "AWAP checkpoint wire payload exceeds 2 MiB; retain the last validated checkpoint",
      );
    return raw;
  },
} as const;
