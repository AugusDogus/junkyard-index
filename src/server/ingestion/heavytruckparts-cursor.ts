import { z } from "zod";
import {
  HTP_SUPPLIERS,
  type HtpSupplier,
  htpCatalogUrl,
  htpStoreUrl,
  htpYearMakeUrl,
  htpYearUrl,
} from "./heavytruckparts-yard-metadata";
import {
  htpFillMake,
  htpPageSchema,
  htpRoster,
  htpYearPageSchema,
  htpYearPlan,
  type HtpPage,
  type HtpYearPage,
} from "./heavytruckparts-census";
// Pure corruption check, safe for Workflow cursor imports.
import { inventoryCheckpointFingerprint as hash } from "./inventory-checkpoint-fingerprint";

export const HTP_MAX_CURSOR_BYTES = 8 * 1024 * 1024;
const scope = hash([HTP_SUPPLIERS, "salvage-only-dual-sort-year-make-fill-v3"]);
const totalSchema = z.number().int().min(1).max(2000);
const censusSchema = z
  .object({
    code: z.string(),
    total: totalSchema,
    pages: z.array(z.unknown()).max(160),
    fills: z.array(z.unknown()).max(160),
  })
  .strict();
const common = {
  source: z.literal("heavytruckparts"),
  version: z.literal(1),
  scope: z.literal(scope),
  startedAt: z.number().int().nonnegative(),
  requests: z.number().int().min(0).max(512),
  bytes: z
    .number()
    .int()
    .min(0)
    .max(512 * 2 * 1024 * 1024),
  previousAcceptedCount: z.number().int().nonnegative().nullable(),
  completed: z.array(censusSchema).max(20),
};
const schema = z.discriminatedUnion("phase", [
  z.object({ ...common, phase: z.literal("store-opening") }).strict(),
  z
    .object({
      ...common,
      phase: z.literal("catalog"),
      total: totalSchema,
      pages: z.array(z.unknown()).max(160),
    })
    .strict(),
  z
    .object({
      ...common,
      phase: z.literal("year-fill"),
      total: totalSchema,
      pages: z.array(z.unknown()).max(160),
      fills: z.array(z.unknown()).max(160),
    })
    .strict(),
  z
    .object({
      ...common,
      phase: z.literal("store-closing"),
      total: totalSchema,
      pages: z.array(z.unknown()).max(160),
      fills: z.array(z.unknown()).max(160),
    })
    .strict(),
  z.object({ ...common, phase: z.literal("ready") }).strict(),
  z.object({ ...common, phase: z.literal("complete") }).strict(),
]);
export type HtpCensus = {
  code: string;
  total: number;
  pages: HtpPage[];
  fills: HtpYearPage[];
};
// Keep the discriminated union explicit when replacing boundary-unknown pages.
type Parsed =
  | (Omit<
      Extract<z.infer<typeof schema>, { phase: "catalog" }>,
      "completed" | "pages"
    > & { completed: HtpCensus[]; pages: HtpPage[] })
  | (Omit<
      Extract<z.infer<typeof schema>, { phase: "year-fill" | "store-closing" }>,
      "completed" | "pages" | "fills"
    > & { completed: HtpCensus[]; pages: HtpPage[]; fills: HtpYearPage[] })
  | (Omit<
      Exclude<
        z.infer<typeof schema>,
        { phase: "catalog" | "year-fill" | "store-closing" }
      >,
      "completed"
    > & { completed: HtpCensus[] });
export type HtpCursor = Parsed & { checksum: string };
function supplier(index: number): HtpSupplier {
  const s = HTP_SUPPLIERS[index];
  if (!s) throw new Error("HTP checkpoint exceeds configured supplier order");
  return s;
}
export function htpNextPage(pages: readonly HtpPage[], total: number) {
  const last = Math.ceil(total / 25),
    index = pages.length;
  return index < last * 2
    ? {
        direction: index < last ? ("DESC" as const) : ("ASC" as const),
        page: (index % last) + 1,
      }
    : null;
}
/** The next single-year fill once both year orders are complete. */
export function htpNextFill(
  s: HtpSupplier,
  pages: readonly HtpPage[],
  fills: readonly HtpYearPage[],
  total: number,
) {
  return htpYearPlan(s, pages, total)[fills.length] ?? null;
}
function parsePages(
  raw: readonly unknown[],
  s: HtpSupplier,
  total: number,
): HtpPage[] {
  const pages = raw.map((p) => htpPageSchema(s).parse(p));
  const last = Math.ceil(total / 25);
  if (
    pages.length > last * 2 ||
    pages.some(
      (p, i) =>
        p.direction !== (i < last ? "DESC" : "ASC") ||
        p.page !== (i % last) + 1 ||
        p.records.length !== Math.min(25, total - (p.page - 1) * 25),
    )
  )
    throw new Error(`HTP ${s.code} checkpoint lost its exact page frontier`);
  return pages;
}
function parseFills(
  raw: readonly unknown[],
  s: HtpSupplier,
  pages: readonly HtpPage[],
  total: number,
  complete: boolean,
): HtpYearPage[] {
  const fills = raw.map((p) => htpYearPageSchema(s).parse(p));
  const plan = htpYearPlan(s, pages, total);
  if (
    fills.length > plan.length ||
    fills.some((f, i) => {
      const e = plan[i];
      return (
        !e ||
        f.year !== e.year ||
        f.direction !== e.direction ||
        f.make !== htpFillMake(e)
      );
    })
  )
    throw new Error(
      `HTP ${s.code} checkpoint lost its exact year-fill frontier`,
    );
  if (complete) htpRoster(s, pages, fills, total);
  return fills;
}
function checkpoint(input: unknown): HtpCursor {
  const state = schema.parse(input);
  const completed = state.completed.map((c, i) => {
    const s = supplier(i);
    if (c.code !== s.code)
      throw new Error("HTP checkpoint changed supplier order");
    const pages = parsePages(c.pages, s, c.total);
    return { ...c, pages, fills: parseFills(c.fills, s, pages, c.total, true) };
  });
  let parsed: Parsed,
    requests = completed.reduce(
      (sum, c) => sum + 2 + c.pages.length + c.fills.length,
      0,
    );
  if (state.phase === "catalog") {
    const pages = parsePages(
      state.pages,
      supplier(completed.length),
      state.total,
    );
    if (!htpNextPage(pages, state.total))
      throw new Error("HTP catalog frontier is already exhausted");
    parsed = { ...state, completed, pages };
    requests += 1 + pages.length;
  } else if (state.phase === "year-fill" || state.phase === "store-closing") {
    const s = supplier(completed.length);
    const pages = parsePages(state.pages, s, state.total);
    const fills = parseFills(
      state.fills,
      s,
      pages,
      state.total,
      state.phase === "store-closing",
    );
    if (
      state.phase === "year-fill" &&
      !htpNextFill(s, pages, fills, state.total)
    )
      throw new Error("HTP year-fill frontier is already exhausted");
    parsed = { ...state, completed, pages, fills };
    requests += 1 + pages.length + fills.length;
  } else {
    parsed = { ...state, completed };
    if (
      state.phase === "ready" || state.phase === "complete"
        ? completed.length !== HTP_SUPPLIERS.length
        : completed.length >= HTP_SUPPLIERS.length
    )
      throw new Error("HTP terminal evidence lost a supplier");
  }
  if (
    requests !== state.requests ||
    (requests === 0
      ? state.bytes !== 0 || state.startedAt !== 0
      : state.bytes < requests ||
        state.bytes > requests * 2 * 1024 * 1024 ||
        state.startedAt <= 0)
  )
    throw new Error("HTP checkpoint request/byte accounting changed");
  const result = { ...parsed, checksum: hash(parsed) };
  if (
    new TextEncoder().encode(JSON.stringify(result)).byteLength >
    HTP_MAX_CURSOR_BYTES
  )
    throw new Error("HTP checkpoint exceeds 8 MiB");
  return result;
}
function parse(input: unknown): HtpCursor {
  const { checksum, ...state } = z
    .object({ checksum: z.string() })
    .passthrough()
    .parse(input);
  const checked = checkpoint(state);
  if (checksum !== checked.checksum)
    throw new Error("HTP checkpoint checksum changed; retain prior inventory");
  return checked;
}
export const HeavytruckpartsCursor = {
  initial: (previousAcceptedCount: number | null = null): HtpCursor =>
    checkpoint({
      source: "heavytruckparts",
      version: 1,
      scope,
      startedAt: 0,
      requests: 0,
      bytes: 0,
      previousAcceptedCount,
      completed: [],
      phase: "store-opening",
    }),
  checkpoint,
  parse,
  fromWire(raw: string): HtpCursor {
    if (new TextEncoder().encode(raw).byteLength > HTP_MAX_CURSOR_BYTES)
      throw new Error("HTP wire checkpoint exceeds 8 MiB");
    return parse(JSON.parse(raw));
  },
  serialize: (cursor: HtpCursor) => JSON.stringify(parse(cursor)),
  nextUrl(cursor: HtpCursor): string {
    const s = supplier(cursor.completed.length);
    if (cursor.phase === "catalog") {
      const next = htpNextPage(cursor.pages, cursor.total);
      if (!next) throw new Error("HTP catalog frontier exhausted");
      return htpCatalogUrl(s, next.direction, next.page);
    }
    if (cursor.phase === "year-fill") {
      const next = htpNextFill(s, cursor.pages, cursor.fills, cursor.total);
      if (!next) throw new Error("HTP year-fill frontier exhausted");
      return next.kind === "year"
        ? htpYearUrl(s, next.year, next.direction, 1)
        : htpYearMakeUrl(s, next.year, next.make);
    }
    if (cursor.phase === "store-opening" || cursor.phase === "store-closing")
      return htpStoreUrl(s);
    throw new Error("HTP terminal checkpoint cannot fetch");
  },
} as const;
