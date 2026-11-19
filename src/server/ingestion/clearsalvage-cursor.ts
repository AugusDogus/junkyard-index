import { z } from "zod";
import {
  clearsalvageHash,
  ClearsalvageCatalogSchema,
  ClearsalvageRecordSchema,
} from "./clearsalvage-parser";
import {
  clearsalvageSnapshot,
  validateClearsalvageSnapshot,
} from "./clearsalvage-transform";
import {
  CLEARSALVAGE_MAX_PAGES,
  CLEARSALVAGE_PAGE_SIZE,
  CLEARSALVAGE_YARD,
  clearsalvageCatalogPage,
  clearsalvageCatalogUrl,
} from "./clearsalvage-yard-metadata";

export const CLEARSALVAGE_MAX_CURSOR_BYTES = 4 * 1024 * 1024;
export const CLEARSALVAGE_MAX_REQUESTS =
  CLEARSALVAGE_MAX_PAGES * (CLEARSALVAGE_PAGE_SIZE + 2);
export const CLEARSALVAGE_MAX_BODY_BYTES = 128 * 1024 * 1024;
export const CLEARSALVAGE_MAX_ELAPSED_MS = 60 * 60 * 1000;
/** Host refusals (HTTP 403/429) waited out per census before it rejects.
 * The 11-19 census got one 403 on a published donor that served 200 later. */
export const CLEARSALVAGE_HOST_COOLDOWNS_MS = [
  2 * 60 * 1000,
  5 * 60 * 1000,
  10 * 60 * 1000,
] as const;
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const scope = clearsalvageHash({
  yard: CLEARSALVAGE_YARD,
  contract:
    "published-inventory/primary-native-claims/title-model-manufacturer/all-page-closure-v1",
  maximumPages: CLEARSALVAGE_MAX_PAGES,
  maximumBodyBytes: CLEARSALVAGE_MAX_BODY_BYTES,
  maximumElapsedMs: CLEARSALVAGE_MAX_ELAPSED_MS,
});
const base = { source: z.literal("clearsalvage"), version: z.literal(1) };
const progress = {
  ...base,
  scope: z.literal(scope),
  checksum: hash,
  startedAt: z.number().int().nonnegative(),
  bodyBytes: z.number().int().nonnegative().max(CLEARSALVAGE_MAX_BODY_BYTES),
  pages: z.array(ClearsalvageCatalogSchema).max(CLEARSALVAGE_MAX_PAGES),
  /** Host refusals already waited out in this census. */
  hostBlocks: z
    .number()
    .int()
    .min(1)
    .max(CLEARSALVAGE_HOST_COOLDOWNS_MS.length)
    .optional(),
  /** Durable Workflow sleeps until this time before the refused request repeats. */
  retryAt: z.number().int().nonnegative().safe().optional(),
};
const records = z
  .array(ClearsalvageRecordSchema)
  .max(CLEARSALVAGE_MAX_PAGES * CLEARSALVAGE_PAGE_SIZE);
const ProgressSchema = z.discriminatedUnion("phase", [
  z.object({ ...progress, phase: z.literal("catalog") }).strict(),
  z.object({ ...progress, phase: z.literal("details"), records }).strict(),
  z
    .object({
      ...progress,
      phase: z.literal("closing"),
      records,
      closing: z.number().int().nonnegative().max(CLEARSALVAGE_MAX_PAGES),
      closingBodyBytes: z
        .number()
        .int()
        .nonnegative()
        .max(CLEARSALVAGE_MAX_BODY_BYTES),
    })
    .strict(),
]);
export type ClearsalvageProgress = z.infer<typeof ProgressSchema>;
const checksum = (value: ClearsalvageProgress) =>
  clearsalvageHash({ ...value, checksum: null });
export const ClearsalvageCursorSchema = z
  .union([
    z.object({ ...base, phase: z.literal("start") }).strict(),
    z.object({ ...base, phase: z.literal("complete") }).strict(),
    ProgressSchema,
  ])
  .superRefine((state, context) => {
    if (state.phase === "start" || state.phase === "complete") return;
    try {
      if (
        Buffer.byteLength(JSON.stringify(state)) >
          CLEARSALVAGE_MAX_CURSOR_BYTES ||
        checksum(state) !== state.checksum
      )
        throw new Error("Clear Salvage checkpoint size or integrity changed");
      if (
        state.retryAt !== undefined &&
        (state.hostBlocks === undefined ||
          state.retryAt <= state.startedAt ||
          state.retryAt >= state.startedAt + CLEARSALVAGE_MAX_ELAPSED_MS)
      )
        throw new Error(
          "Clear Salvage cooldown is not bound to a recorded host refusal inside the census hour",
        );
      const first = state.pages[0],
        last = state.pages.at(-1);
      const posts = state.pages.flatMap((page) => page.posts);
      if (
        new Set(posts.map((post) => post.id)).size !== posts.length ||
        new Set(posts.map((post) => post.url)).size !== posts.length ||
        posts.some(
          (post, index) => index > 0 && post.id <= (posts[index - 1]?.id ?? 0),
        )
      )
        throw new Error(
          "Clear Salvage checkpoint repeats or reorders native donor identities",
        );
      for (const [index, page] of state.pages.entries()) {
        if (
          page.page !== index + 1 ||
          clearsalvageCatalogPage(page.url) !== page.page ||
          page.total !== first?.total ||
          page.lastPage !== first?.lastPage ||
          Math.ceil(page.total / CLEARSALVAGE_PAGE_SIZE) !== page.lastPage ||
          page.posts.length !==
            (page.page < page.lastPage
              ? CLEARSALVAGE_PAGE_SIZE
              : page.total - (page.page - 1) * CLEARSALVAGE_PAGE_SIZE) ||
          page.next !==
            (page.page < page.lastPage
              ? clearsalvageCatalogUrl(page.page + 1)
              : null) ||
          (index > 0 && state.pages[index - 1]?.next !== page.url)
        )
          throw new Error(
            "Clear Salvage checkpoint is not a contiguous native catalog prefix",
          );
      }
      let bytes = state.pages.reduce((sum, page) => sum + page.bodyBytes, 0);
      if (state.phase === "catalog") {
        if (last?.next === null)
          throw new Error(
            "Clear Salvage terminal catalog cannot remain in catalog phase",
          );
      } else {
        if (
          !first ||
          !last ||
          last.next !== null ||
          state.pages.length !== first.lastPage ||
          posts.length !== first.total ||
          state.records.some(
            (record, index) =>
              JSON.stringify(record.post) !== JSON.stringify(posts[index]),
          ) ||
          (state.phase === "details"
            ? state.records.length >= posts.length
            : state.records.length !== posts.length ||
              state.closing > state.pages.length)
        )
          throw new Error(
            "Clear Salvage donor or closing checkpoint does not bind to its complete native roster",
          );
        bytes += state.records.reduce(
          (sum, record) => sum + record.bodyBytes,
          0,
        );
        const snapshot = clearsalvageSnapshot(state.records);
        if (state.phase === "closing") {
          validateClearsalvageSnapshot(snapshot);
          if ((state.closing === 0) !== (state.closingBodyBytes === 0))
            throw new Error(
              "Clear Salvage closing byte accounting is inconsistent",
            );
          bytes += state.closingBodyBytes;
        }
      }
      if (bytes !== state.bodyBytes)
        throw new Error(
          "Clear Salvage checkpoint body bytes disagree with retained native responses",
        );
    } catch (cause) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          cause instanceof Error
            ? cause.message
            : "Invalid Clear Salvage checkpoint",
      });
    }
  });
export type ClearsalvageCursor = z.infer<typeof ClearsalvageCursorSchema>;
function checkpoint(value: unknown): ClearsalvageProgress {
  const state = ProgressSchema.parse(value);
  const parsed = ClearsalvageCursorSchema.parse({
    ...state,
    checksum: checksum(state),
  });
  if (parsed.phase === "start" || parsed.phase === "complete")
    throw new Error("Expected a resumable Clear Salvage checkpoint");
  return parsed;
}
export const ClearsalvageCursor = {
  initial: {
    source: "clearsalvage",
    version: 1,
    phase: "start",
  } satisfies ClearsalvageCursor,
  start(now: number): ClearsalvageProgress {
    return checkpoint({
      source: "clearsalvage",
      version: 1,
      scope,
      checksum: "0".repeat(64),
      phase: "catalog",
      startedAt: now,
      bodyBytes: 0,
      pages: [],
    });
  },
  checkpoint,
  /** The progress a request resumes from, without its elapsed cooldown. */
  resume(progress: ClearsalvageProgress): ClearsalvageProgress {
    const resumed = { ...progress };
    delete resumed.retryAt;
    return resumed;
  },
  parse(raw: string): ClearsalvageCursor {
    if (Buffer.byteLength(raw) > CLEARSALVAGE_MAX_CURSOR_BYTES)
      throw new Error(
        "Clear Salvage checkpoint wire payload exceeds 4 MiB; retain the last validated checkpoint",
      );
    const value: unknown = JSON.parse(raw);
    return ClearsalvageCursorSchema.parse(value);
  },
  serialize(cursor: ClearsalvageCursor): string {
    const raw = JSON.stringify(ClearsalvageCursorSchema.parse(cursor));
    if (Buffer.byteLength(raw) > CLEARSALVAGE_MAX_CURSOR_BYTES)
      throw new Error(
        "Clear Salvage checkpoint wire payload exceeds 4 MiB; retain the last validated checkpoint",
      );
    return raw;
  },
} as const;
