import { z } from "zod";
import {
  citymotorsHash,
  citymotorsCatalogHash,
  CitymotorsCatalogSchema,
  CitymotorsRecordSchema,
} from "./citymotors-parser";
import {
  citymotorsSnapshot,
  validateCitymotorsSnapshot,
} from "./citymotors-transform";
import {
  CITYMOTORS_CATALOG,
  CITYMOTORS_YARD,
  citymotorsCatalogPage,
} from "./citymotors-yard-metadata";

export const CITYMOTORS_MAX_CURSOR_BYTES = 1024 * 1024;
export const CITYMOTORS_MAX_REQUESTS = 1088;
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const base = { source: z.literal("citymotors"), version: z.literal(1) };
const progress = {
  ...base,
  scope: z.literal(
    citymotorsHash({
      yard: CITYMOTORS_YARD,
      contract:
        "native-primary-fields/reviewed-wording/no-character-repair/all-page-closure-v1",
    }),
  ),
  checksum: hash,
  pages: z.array(CitymotorsCatalogSchema).max(32),
};
const records = z.array(CitymotorsRecordSchema).max(1024);
const ProgressSchema = z.discriminatedUnion("phase", [
  z.object({ ...progress, phase: z.literal("catalog") }).strict(),
  z.object({ ...progress, phase: z.literal("details"), records }).strict(),
  z
    .object({
      ...progress,
      phase: z.literal("closing"),
      records,
      closing: z.number().int().min(0).max(32),
    })
    .strict(),
]);
export type CitymotorsProgress = z.infer<typeof ProgressSchema>;
function checksum(state: CitymotorsProgress) {
  return citymotorsHash({ ...state, checksum: null });
}
export const CitymotorsCursorSchema = z
  .union([
    z.object({ ...base, phase: z.literal("complete") }).strict(),
    ProgressSchema,
  ])
  .superRefine((state, context) => {
    if (state.phase === "complete") return;
    try {
      if (
        Buffer.byteLength(JSON.stringify(state)) >
          CITYMOTORS_MAX_CURSOR_BYTES ||
        checksum(state) !== state.checksum
      )
        throw new Error("City Motors checkpoint size or integrity changed");
      const first = state.pages[0];
      const posts = state.pages.flatMap((page) => page.posts);
      if (
        (first && first.url !== CITYMOTORS_CATALOG) ||
        new Set(posts.map((post) => post.url)).size !== posts.length
      )
        throw new Error(
          "City Motors checkpoint repeats or skips native catalog destinations",
        );
      for (const [index, page] of state.pages.entries()) {
        if (
          page.page !== index + 1 ||
          citymotorsCatalogPage(page.url) !== page.page ||
          page.page > page.lastPage ||
          page.lastPage !== first?.lastPage ||
          (index > 0 && state.pages[index - 1]?.next !== page.url) ||
          page.hash !== citymotorsCatalogHash(page) ||
          (page.page < page.lastPage
            ? citymotorsCatalogPage(page.next ?? "") !== page.page + 1 ||
              page.posts.length !== 32
            : page.next !== null)
        )
          throw new Error(
            "City Motors native catalog checkpoint is not a contiguous validated prefix",
          );
      }
      const last = state.pages.at(-1);
      if (state.phase === "catalog") {
        if (last?.next === null)
          throw new Error(
            "City Motors terminal catalog cannot remain in catalog phase",
          );
      } else {
        if (
          !first ||
          !last ||
          last.next !== null ||
          state.pages.length !== first.lastPage ||
          state.records.some(
            (record, index) =>
              JSON.stringify(record.post) !== JSON.stringify(posts[index]),
          )
        )
          throw new Error(
            "City Motors donor checkpoint does not bind to its complete native catalog",
          );
        if (
          state.phase === "details"
            ? state.records.length >= posts.length
            : state.records.length !== posts.length ||
              state.closing > state.pages.length
        )
          throw new Error(
            "City Motors donor or closing prefix is inconsistent",
          );
        const snapshot = citymotorsSnapshot(state.records);
        if (state.phase === "closing") validateCitymotorsSnapshot(snapshot);
      }
    } catch (cause) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          cause instanceof Error
            ? cause.message
            : "Invalid City Motors checkpoint",
      });
    }
  });
export type CitymotorsCursor = z.infer<typeof CitymotorsCursorSchema>;
function checkpoint(value: unknown): CitymotorsProgress {
  const canonical = ProgressSchema.parse(value);
  const parsed = CitymotorsCursorSchema.parse({
    ...canonical,
    checksum: checksum(canonical),
  });
  if (parsed.phase === "complete")
    throw new Error("Expected resumable City Motors checkpoint");
  return parsed;
}
export const CitymotorsCursor = {
  initial: checkpoint({
    source: "citymotors",
    version: 1,
    scope: progress.scope.value,
    checksum: "0".repeat(64),
    phase: "catalog",
    pages: [],
  }),
  checkpoint,
  parse(raw: string): CitymotorsCursor {
    if (Buffer.byteLength(raw) > CITYMOTORS_MAX_CURSOR_BYTES)
      throw new Error(
        "City Motors checkpoint wire payload exceeds 1 MiB; retain the last validated checkpoint",
      );
    const value: unknown = JSON.parse(raw);
    return CitymotorsCursorSchema.parse(value);
  },
  serialize(cursor: CitymotorsCursor): string {
    const raw = JSON.stringify(CitymotorsCursorSchema.parse(cursor));
    if (Buffer.byteLength(raw) > CITYMOTORS_MAX_CURSOR_BYTES)
      throw new Error(
        "City Motors checkpoint wire payload exceeds 1 MiB; retain the last validated checkpoint",
      );
    return raw;
  },
} as const;
