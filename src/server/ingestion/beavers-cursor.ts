import { createHash } from "node:crypto";
import { z } from "zod";
import { BeaversCatalogSchema, BeaversRecordSchema } from "./beavers-parser";
import {
  BEAVERS_CATALOG,
  BEAVERS_YARD,
  beaversDetailUrl,
  beaversPage,
} from "./beavers-yard-metadata";

const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const BEAVERS_MAX_CURSOR_BYTES = 2 * 1024 * 1024;
const base = { source: z.literal("beavers"), version: z.literal(1) };
const common = {
  ...base,
  scope: z.literal(hash([BEAVERS_YARD, "literal-503-roster-donor-closure-v1"])),
  checksum: z.string(),
  pages: z.array(BeaversCatalogSchema).max(100),
  records: z.array(BeaversRecordSchema).max(2000),
};
const progress = z.discriminatedUnion("phase", [
  z.object({ ...common, phase: z.literal("catalog") }).strict(),
  z.object({ ...common, phase: z.literal("route") }).strict(),
  z
    .object({ ...common, phase: z.literal("detail"), pending: z.string() })
    .strict(),
  z
    .object({
      ...common,
      phase: z.literal("closing"),
      closing: z.number().int().min(0).max(100),
    })
    .strict(),
]);
export type BeaversProgress = z.infer<typeof progress>;
export const BeaversCursorSchema = z
  .union([
    z.object({ ...base, phase: z.literal("complete") }).strict(),
    progress,
  ])
  .superRefine((state, context) => {
    if (state.phase === "complete") return;
    try {
      if (
        Buffer.byteLength(JSON.stringify(state)) > BEAVERS_MAX_CURSOR_BYTES ||
        state.checksum !== hash({ ...state, checksum: null })
      )
        throw new Error("Beaver's cursor size or checksum changed");
      const rows = state.pages.flatMap((page) => page.rows),
        first = state.pages[0],
        last = state.pages.at(-1);
      if (new Set(rows.map((row) => row.url)).size !== rows.length)
        throw new Error("Beaver's cursor repeats donor destinations");
      state.pages.forEach((page, index) => {
        const lastPage = Math.ceil(page.total / 20);
        if (
          page.page !== index + 1 ||
          beaversPage(page.url) !== page.page ||
          (index === 0
            ? page.url !== BEAVERS_CATALOG
            : state.pages[index - 1]?.next !== page.url) ||
          page.total !== first?.total ||
          page.page > lastPage ||
          page.rows.length !== Math.min(20, page.total - index * 20) ||
          (page.page < lastPage
            ? beaversPage(page.next ?? "") !== page.page + 1
            : page.next !== null) ||
          JSON.stringify(
            page.controls
              .filter(([label]) => label === ">")
              .map(([, url]) => url),
          ) !== JSON.stringify(page.next ? [page.next] : [])
        )
          throw new Error(
            "Beaver's cursor catalog is not a contiguous native prefix",
          );
      });
      state.records.forEach((record, index) => {
        if (
          JSON.stringify(record.row) !== JSON.stringify(rows[index]) ||
          record.url !== beaversDetailUrl(record.row.url)
        )
          throw new Error(
            "Beaver's saved donor lost its published roster join",
          );
      });
      if (state.phase === "catalog") {
        if (state.records.length || last?.next === null)
          throw new Error(
            "Beaver's catalog phase has premature donors or terminal pages",
          );
      } else {
        if (
          !first ||
          !last ||
          last.next !== null ||
          rows.length !== first.total ||
          state.pages.length !== Math.ceil(first.total / 20)
        )
          throw new Error(
            "Beaver's donor phase lacks a complete native roster",
          );
        if (
          state.phase === "closing"
            ? state.records.length !== rows.length ||
              state.closing > state.pages.length
            : state.records.length >= rows.length
        )
          throw new Error("Beaver's donor or closing prefix is inconsistent");
        if (state.phase === "detail") {
          const row = rows[state.records.length];
          if (!row || state.pending !== beaversDetailUrl(row.url))
            throw new Error(
              "Beaver's pending redirect changed native tenant or donor",
            );
        }
      }
    } catch (cause) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          cause instanceof Error ? cause.message : "Invalid Beaver's cursor",
      });
    }
  });
export type BeaversCursor = z.infer<typeof BeaversCursorSchema>;
function checkpoint(value: unknown): BeaversProgress {
  const state = progress.parse(value);
  const checked = BeaversCursorSchema.parse({
    ...state,
    checksum: hash({ ...state, checksum: null }),
  });
  if (checked.phase === "complete")
    throw new Error("Expected Beaver's resumable checkpoint");
  return checked;
}
export const BeaversCursor = {
  initial: checkpoint({
    source: "beavers",
    version: 1,
    scope: common.scope.value,
    checksum: "",
    phase: "catalog",
    pages: [],
    records: [],
  }),
  checkpoint,
  serialize(value: BeaversCursor) {
    return JSON.stringify(BeaversCursorSchema.parse(value));
  },
  parse(raw: string) {
    if (Buffer.byteLength(raw) > BEAVERS_MAX_CURSOR_BYTES)
      throw new Error(
        "Beaver's cursor exceeds2 MiB; retain the previous checkpoint",
      );
    const value: unknown = JSON.parse(raw);
    return BeaversCursorSchema.parse(value);
  },
} as const;
