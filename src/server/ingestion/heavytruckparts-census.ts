import { z } from "zod";
import { heavyTruckPartsRecord } from "./heavytruckparts-record";
import {
  HTP_MAKE_SLUG,
  type HtpSupplier,
} from "./heavytruckparts-yard-metadata";

function htpRecords(s: HtpSupplier) {
  return z
    .array(
      heavyTruckPartsRecord({ ...s, attributes: "marketplace" }).recordSchema,
    )
    .min(1)
    .max(25);
}
export function htpPageSchema(s: HtpSupplier) {
  return z
    .object({
      direction: z.enum(["DESC", "ASC"]),
      page: z.number().int().min(1).max(80),
      records: htpRecords(s),
    })
    .strict();
}
export type HtpPage = z.infer<ReturnType<typeof htpPageSchema>>;
/**
 * Page 1 of one native model year, sorted by make. `make` is the native make
 * path segment, "Any" for the whole year.
 */
export function htpYearPageSchema(s: HtpSupplier) {
  return z
    .object({
      year: z.string().regex(/^\d{4}$/),
      make: z.string().regex(HTP_MAKE_SLUG),
      direction: z.enum(["DESC", "ASC"]),
      records: htpRecords(s),
    })
    .strict();
}
export type HtpYearPage = z.infer<ReturnType<typeof htpYearPageSchema>>;
/** A whole-year fill bounded by its dual-sort count, or one make's single page. */
export type HtpYearFill =
  | {
      kind: "year";
      year: string;
      direction: "DESC" | "ASC";
      count: number;
    }
  | { kind: "make"; year: string; direction: "DESC"; make: string };
export function htpFillMake(fill: HtpYearFill) {
  return fill.kind === "year" ? "Any" : fill.make;
}
type Row = HtpPage["records"][number];
/** The make path segment of a row's native item URL. */
export function htpRowMake(s: HtpSupplier, row: Row) {
  const make = new URL(row.url).pathname.split("/")[2] ?? "";
  if (!HTP_MAKE_SLUG.test(make) || make === "Any")
    throw new Error(
      `HTP ${s.code} item ${row.id} has make path segment ${JSON.stringify(make)}, which no make fill can query`,
    );
  return make;
}

function addRow(s: HtpSupplier, rows: Map<string, Row>, row: Row) {
  const prior = rows.get(row.id);
  if (prior && JSON.stringify(prior) !== JSON.stringify(row))
    throw new Error(`HTP ${s.code} repeated item changed between year orders`);
  rows.set(row.id, row);
}
/** Both complete native year orders, with equal per-year row counts. */
function htpOrders(s: HtpSupplier, pages: readonly HtpPage[], total: number) {
  const rows = new Map<string, Row>(),
    years: string[] = [];
  let counts = new Map<string, number>();
  const size = Math.ceil(total / 25);
  for (const direction of ["DESC", "ASC"] as const) {
    const group = pages.filter((p) => p.direction === direction);
    if (
      group.length !== size ||
      group.some(
        (p, i) =>
          p.page !== i + 1 || p.records.length !== Math.min(25, total - i * 25),
      )
    )
      throw new Error(`HTP ${s.code} census lost a complete year order`);
    counts = new Map<string, number>();
    for (const row of group.flatMap((p) => p.records)) {
      counts.set(row.year, (counts.get(row.year) ?? 0) + 1);
      addRow(s, rows, row);
    }
    years.push(JSON.stringify([...counts].sort()));
  }
  if (pages.length !== size * 2 || years[0] !== years[1])
    throw new Error(
      `HTP ${s.code} dual-sort census does not reconcile to store count`,
    );
  return { rows, counts };
}
function yearIds(rows: Map<string, Row>) {
  const ids = new Map<string, number>();
  for (const row of rows.values())
    ids.set(row.year, (ids.get(row.year) ?? 0) + 1);
  return ids;
}
function plan(
  s: HtpSupplier,
  rows: Map<string, Row>,
  counts: Map<string, number>,
): HtpYearFill[] {
  const ids = yearIds(rows);
  return [...counts]
    .filter(([year, count]) => (ids.get(year) ?? 0) < count)
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([year, count]): HtpYearFill[] => {
      // Native ties have no stable order, so only single complete pages, or
      // both ends of a two-page year, can enumerate every item.
      if (!/^\d{4}$/.test(year))
        throw new Error(
          `HTP ${s.code} year ${JSON.stringify(year)} lists ${count} tied items, but year orders show ${ids.get(year) ?? 0} and only four-digit years can be filled`,
        );
      if (count <= 25)
        return [{ kind: "year", year, direction: "DESC", count }];
      if (count <= 50)
        return [
          { kind: "year", year, direction: "DESC", count },
          { kind: "year", year, direction: "ASC", count },
        ];
      // Larger years split into one single complete page per make seen in
      // that year. An item whose make no year order showed stays missing, so
      // the per-year count check in htpRoster still fails closed.
      const makes = new Map<string, number>();
      for (const row of rows.values())
        if (row.year === year) {
          const make = htpRowMake(s, row);
          makes.set(make, (makes.get(make) ?? 0) + 1);
        }
      for (const [make, seen] of makes)
        if (seen > 25)
          throw new Error(
            `HTP ${s.code} year ${year} lists ${count} tied items, but year orders show ${ids.get(year) ?? 0} and ${seen} of them are make ${make}, over the 25 a single make page covers`,
          );
      return [...makes.keys()].sort().map(
        (make): HtpYearFill => ({
          kind: "make",
          year,
          direction: "DESC",
          make,
        }),
      );
    });
}
/** Single-year fills for years whose dual-sort union misses tied items. */
export function htpYearPlan(
  s: HtpSupplier,
  pages: readonly HtpPage[],
  total: number,
): HtpYearFill[] {
  const { rows, counts } = htpOrders(s, pages, total);
  return plan(s, rows, counts);
}

/**
 * Both complete native year orders, plus single-year fills for tied years,
 * must reconcile to one store total.
 */
export function htpRoster(
  s: HtpSupplier,
  pages: readonly HtpPage[],
  fills: readonly HtpYearPage[],
  total: number,
) {
  const { rows, counts } = htpOrders(s, pages, total);
  const expected = plan(s, rows, counts);
  if (
    fills.length !== expected.length ||
    fills.some((f, i) => {
      const e = expected[i];
      return (
        !e ||
        f.year !== e.year ||
        f.direction !== e.direction ||
        f.make !== htpFillMake(e) ||
        (e.kind === "year"
          ? f.records.length !== Math.min(25, e.count)
          : f.records.some((r) => htpRowMake(s, r) !== e.make)) ||
        f.records.some((r) => r.year !== f.year)
      );
    })
  )
    throw new Error(`HTP ${s.code} year fills do not match the tied years`);
  for (const row of fills.flatMap((f) => f.records)) addRow(s, rows, row);
  const ids = yearIds(rows);
  for (const [year, count] of counts)
    if (ids.get(year) !== count)
      throw new Error(
        `HTP ${s.code} year ${year} lists ${ids.get(year) ?? 0} of ${count} items after year fills`,
      );
  if (rows.size !== total)
    throw new Error(
      `HTP ${s.code} dual-sort census does not reconcile to store count`,
    );
  return [...rows.values()].sort((a, b) => a.id.localeCompare(b.id));
}
