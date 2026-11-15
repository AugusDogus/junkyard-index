import { z } from "zod";
import {
  HTP_SUPPLIERS,
  type HtpSupplier,
  htpCatalogUrl,
  htpStoreUrl,
} from "./heavytruckparts-yard-metadata";
import {
  htpPageSchema,
  htpRoster,
  type HtpPage,
} from "./heavytruckparts-census";

export const HTP_MAX_CURSOR_BYTES = 8 * 1024 * 1024;
// Pure corruption check, safe for Workflow cursor imports.
function hash(value: unknown): string {
  let result = 2166136261;
  for (const char of JSON.stringify(value))
    result = Math.imul(result ^ char.charCodeAt(0), 16777619);
  return (result >>> 0).toString(16).padStart(8, "0");
}
const scope = hash([HTP_SUPPLIERS, "salvage-only-dual-sort-v1"]);
const totalSchema = z.number().int().min(1).max(2000);
const censusSchema = z
  .object({
    code: z.string(),
    total: totalSchema,
    pages: z.array(z.unknown()).max(160),
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
      phase: z.literal("store-closing"),
      total: totalSchema,
      pages: z.array(z.unknown()).max(160),
    })
    .strict(),
  z.object({ ...common, phase: z.literal("ready") }).strict(),
  z.object({ ...common, phase: z.literal("complete") }).strict(),
]);
export type HtpCensus = { code: string; total: number; pages: HtpPage[] };
// Keep the discriminated union explicit when replacing boundary-unknown pages.
type Parsed =
  | (Omit<
      Extract<z.infer<typeof schema>, { phase: "catalog" | "store-closing" }>,
      "completed" | "pages"
    > & { completed: HtpCensus[]; pages: HtpPage[] })
  | (Omit<
      Exclude<z.infer<typeof schema>, { phase: "catalog" | "store-closing" }>,
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
function parsePages(
  raw: readonly unknown[],
  s: HtpSupplier,
  total: number,
  complete: boolean,
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
  if (complete) htpRoster(s, pages, total);
  return pages;
}
function checkpoint(input: unknown): HtpCursor {
  const state = schema.parse(input);
  const completed = state.completed.map((c, i) => {
    const s = supplier(i);
    if (c.code !== s.code)
      throw new Error("HTP checkpoint changed supplier order");
    return { ...c, pages: parsePages(c.pages, s, c.total, true) };
  });
  let parsed: Parsed,
    requests = completed.reduce((sum, c) => sum + 2 + c.pages.length, 0);
  if (state.phase === "catalog" || state.phase === "store-closing") {
    const pages = parsePages(
      state.pages,
      supplier(completed.length),
      state.total,
      state.phase === "store-closing",
    );
    if (state.phase === "catalog" && !htpNextPage(pages, state.total))
      throw new Error("HTP catalog frontier is already exhausted");
    parsed = { ...state, completed, pages };
    requests += 1 + pages.length;
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
    if (cursor.phase === "store-opening" || cursor.phase === "store-closing")
      return htpStoreUrl(s);
    throw new Error("HTP terminal checkpoint cannot fetch");
  },
} as const;
