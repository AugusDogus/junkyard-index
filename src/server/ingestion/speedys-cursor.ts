import { z } from "zod";
import {
  SpeedysCatalogSchema,
  SpeedysRecordSchema,
  speedysHash,
  type SpeedysCatalog,
} from "./speedys-parser";
import { speedysSnapshot, validateSpeedysSnapshot } from "./speedys-transform";
import {
  SPEEDYS_ALL,
  SPEEDYS_CATALOG,
  SPEEDYS_MAX_CATEGORIES,
  SPEEDYS_MAX_DONORS,
  SPEEDYS_YARD,
} from "./speedys-yard-metadata";

export const SPEEDYS_MAX_CURSOR_BYTES = 1024 * 1024;
export const SPEEDYS_MAX_RUN_BYTES = 128 * 1024 * 1024;
export const SPEEDYS_MAX_RUN_REQUESTS =
  2 * (2 + SPEEDYS_MAX_CATEGORIES + SPEEDYS_MAX_DONORS);
export const SPEEDYS_MAX_RUN_MS = 60 * 60 * 1000;
const scope = speedysHash({
  version: 1,
  yard: SPEEDYS_YARD,
  contract:
    "native-default-all-category-union/no-pager/native-heading-claims/all-controls-and-donors-close/no-unjoined-images-v1",
});
const common = {
  source: z.literal("speedys"),
  version: z.literal(1),
  scope: z.literal(scope),
  checksum: z.string().regex(/^[a-f0-9]{64}$/),
  startedAt: z.number().int().nonnegative(),
  pages: z.array(SpeedysCatalogSchema).max(SPEEDYS_MAX_CATEGORIES + 2),
  records: z.array(SpeedysRecordSchema).max(SPEEDYS_MAX_DONORS),
  closing: z.array(SpeedysCatalogSchema).max(SPEEDYS_MAX_CATEGORIES + 2),
  closingRecords: z.array(SpeedysRecordSchema).max(SPEEDYS_MAX_DONORS),
};
const StateSchema = z.discriminatedUnion("phase", [
  z.object({ ...common, phase: z.literal("catalog") }).strict(),
  z.object({ ...common, phase: z.literal("details") }).strict(),
  z.object({ ...common, phase: z.literal("closing") }).strict(),
  z.object({ ...common, phase: z.literal("closing-details") }).strict(),
  z.object({ ...common, phase: z.literal("complete") }).strict(),
]);
type State = z.infer<typeof StateSchema>;
const checksum = (state: State) => speedysHash({ ...state, checksum: null });
const compare = (value: string) => value.trim().toUpperCase();
const sorted = (posts: SpeedysCatalog["posts"]) =>
  [...posts].sort((a, b) => Number(a.id) - Number(b.id));
const equal = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
export function speedysCatalogControls(first: SpeedysCatalog | undefined) {
  return [
    SPEEDYS_CATALOG,
    SPEEDYS_ALL,
    ...(first?.categories.map((v) => SPEEDYS_CATALOG + `?cat=${v.id}&pag=0`) ??
      []),
  ];
}
/** Validate every retained control, not just a cursor's claimed progress counters. */
export function inspectSpeedysCursor(state: State) {
  const first = state.pages[0];
  const posts = first?.posts ?? [];
  const controls = speedysCatalogControls(first);
  if (first) {
    if (
      new Set(first.categories.map((v) => compare(v.make))).size !==
        first.categories.length ||
      first.categories.reduce((n, v) => n + v.count, 0) !== posts.length ||
      new Set(posts.map((v) => v.id)).size !== posts.length ||
      new Set(posts.map((v) => v.url)).size !== posts.length
    )
      throw new Error(
        "Speedys default roster does not equal its unique published make-count union",
      );
    for (const category of first.categories)
      if (
        posts.filter((v) => compare(v.make) === compare(category.make))
          .length !== category.count
      )
        throw new Error(
          "Speedys native category count or make membership disagrees with the default roster",
        );
  }
  const validatePage = (page: SpeedysCatalog, index: number) => {
    const category = first?.categories[index - 2];
    const expected =
      index < 2
        ? posts
        : posts.filter(
            (v) => compare(v.make) === compare(category?.make ?? ""),
          );
    if (
      !first ||
      page.url !== controls[index] ||
      !equal(page.categories, first.categories) ||
      !equal(sorted(page.posts), sorted(expected))
    )
      throw new Error(
        "Speedys native default, ALL or category roster changed or is not a complete control prefix",
      );
  };
  state.pages.forEach(validatePage);
  state.closing.forEach(validatePage);
  state.records.forEach((record, index) => {
    if (!equal(record.post, posts[index]))
      throw new Error(
        "Speedys detail checkpoint changed its enumerated native donor order or identity",
      );
  });
  state.closingRecords.forEach((record, index) => {
    const opening = state.records[index];
    if (
      !opening ||
      !equal(record.post, opening.post) ||
      !equal(record.claims, opening.claims)
    )
      throw new Error(
        "Speedys closing donor required identity or native inventory join drifted",
      );
  });
  const phase = [
    "catalog",
    "details",
    "closing",
    "closing-details",
    "complete",
  ].indexOf(state.phase);
  const lengths = [
    state.pages.length,
    state.records.length,
    state.closing.length,
    state.closingRecords.length,
  ];
  const totals = [controls.length, posts.length, controls.length, posts.length];
  lengths.forEach((length, index) => {
    const total = totals[index] ?? 0;
    if (
      !(index < phase
        ? total > 0 && length === total
        : index === phase
          ? length < total
          : length === 0)
    )
      throw new Error(
        "Speedys checkpoint is not a contiguous listing, donor and closure prefix",
      );
  });
  const receipts = [
    ...state.pages,
    ...state.records,
    ...state.closing,
    ...state.closingRecords,
  ];
  const bytes = receipts.reduce((sum, v) => sum + v.bodyBytes, 0);
  if (
    receipts.length > SPEEDYS_MAX_RUN_REQUESTS ||
    bytes > SPEEDYS_MAX_RUN_BYTES ||
    (receipts.length > 0 && state.startedAt === 0)
  )
    throw new Error(
      "Speedys checkpoint request, byte or elapsed-run origin is invalid",
    );
  const snapshot = speedysSnapshot(state.records);
  if (phase >= 2) validateSpeedysSnapshot(snapshot);
  return { posts, controls, bytes, requests: receipts.length, snapshot };
}
export const SpeedysCursorSchema = StateSchema.superRefine((state, context) => {
  try {
    if (
      state.checksum !== checksum(state) ||
      Buffer.byteLength(JSON.stringify(state)) > SPEEDYS_MAX_CURSOR_BYTES
    )
      throw new Error(
        "Speedys checkpoint checksum, source scope or serialized size changed",
      );
    inspectSpeedysCursor(state);
  } catch (cause) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        cause instanceof Error ? cause.message : "Invalid Speedys checkpoint",
    });
  }
});
export type SpeedysCursor = z.infer<typeof SpeedysCursorSchema>;
function checkpoint(value: unknown): SpeedysCursor {
  const state = StateSchema.parse(value);
  return SpeedysCursorSchema.parse({ ...state, checksum: checksum(state) });
}
export const SpeedysCursor = {
  initial: checkpoint({
    source: "speedys",
    version: 1,
    scope,
    checksum: "0".repeat(64),
    startedAt: 0,
    phase: "catalog",
    pages: [],
    records: [],
    closing: [],
    closingRecords: [],
  }),
  checkpoint,
  parse(raw: string): SpeedysCursor {
    if (Buffer.byteLength(raw) > SPEEDYS_MAX_CURSOR_BYTES)
      throw new Error("Speedys serialized checkpoint exceeds 1 MiB");
    const value: unknown = JSON.parse(raw);
    return SpeedysCursorSchema.parse(value);
  },
  serialize(cursor: SpeedysCursor): string {
    return JSON.stringify(SpeedysCursorSchema.parse(cursor));
  },
} as const;
