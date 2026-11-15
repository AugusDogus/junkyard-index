import { z } from "zod";
import { heavyTruckPartsRecord } from "./heavytruckparts-record";
import { type HtpSupplier } from "./heavytruckparts-yard-metadata";

export function htpPageSchema(s: HtpSupplier) {
  return z
    .object({
      direction: z.enum(["DESC", "ASC"]),
      page: z.number().int().min(1).max(80),
      records: z
        .array(
          heavyTruckPartsRecord({ ...s, attributes: "marketplace" })
            .recordSchema,
        )
        .min(1)
        .max(25),
    })
    .strict();
}
export type HtpPage = z.infer<ReturnType<typeof htpPageSchema>>;

/** Both complete native year orders must reconcile to one store total. */
export function htpRoster(
  s: HtpSupplier,
  pages: readonly HtpPage[],
  total: number,
) {
  const rows = new Map<string, HtpPage["records"][number]>(),
    years: string[] = [];
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
    const counts = new Map<string, number>();
    for (const row of group.flatMap((p) => p.records)) {
      counts.set(row.year, (counts.get(row.year) ?? 0) + 1);
      const prior = rows.get(row.id);
      if (prior && JSON.stringify(prior) !== JSON.stringify(row))
        throw new Error(
          `HTP ${s.code} repeated item changed between year orders`,
        );
      rows.set(row.id, row);
    }
    years.push(JSON.stringify([...counts].sort()));
  }
  if (pages.length !== size * 2 || rows.size !== total || years[0] !== years[1])
    throw new Error(
      `HTP ${s.code} dual-sort census does not reconcile to store count`,
    );
  return [...rows.values()].sort((a, b) => a.id.localeCompare(b.id));
}
