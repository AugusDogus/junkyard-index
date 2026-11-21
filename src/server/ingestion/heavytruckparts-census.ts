import { z } from "zod";
import { heavyTruckPartsRecord } from "./heavytruckparts-record";
import { type HtpSupplier } from "./heavytruckparts-yard-metadata";

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
/** Page 1 of one native model year, sorted by make. */
export function htpYearPageSchema(s: HtpSupplier) {
  return z
    .object({
      year: z.string().regex(/^\d{4}$/),
      direction: z.enum(["DESC", "ASC"]),
      records: htpRecords(s),
    })
    .strict();
}
export type HtpYearPage = z.infer<ReturnType<typeof htpYearPageSchema>>;
export type HtpYearFill = Pick<HtpYearPage, "year" | "direction"> & {
  count: number;
};
type Row = HtpPage["records"][number];

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
      if (!/^\d{4}$/.test(year) || count > 50)
        throw new Error(
          `HTP ${s.code} year ${JSON.stringify(year)} lists ${count} tied items, but year orders show ${ids.get(year) ?? 0} and a single-year fill covers at most 50`,
        );
      return count <= 25
        ? [{ year, direction: "DESC", count }]
        : [
            { year, direction: "DESC", count },
            { year, direction: "ASC", count },
          ];
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
    fills.some(
      (f, i) =>
        f.year !== expected[i]?.year ||
        f.direction !== expected[i]?.direction ||
        f.records.length !== Math.min(25, expected[i]?.count ?? 0) ||
        f.records.some((r) => r.year !== f.year),
    )
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
