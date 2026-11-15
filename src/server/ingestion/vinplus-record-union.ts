import { vinplusStableRecord, type VinplusRecord } from "./vinplus-protocol";

export type VinplusRecordUnion = {
  add: (page: readonly VinplusRecord[]) => void;
  yearCount: (year: number) => number;
  records: () => VinplusRecord[];
};
export const VinplusRecordUnion = {
  /** Public make matching overlaps. Retain the maximum whole-record multiplicity
   * observed in one response, not the sum across queries. This preserves repeated
   * backend rows for analytics reconciliation without counting query overlap.
   * Comparison ignores the derived daily counter and YardSmart photo signatures. */
  create(): VinplusRecordUnion {
    const retained = new Map<
      string,
      { record: VinplusRecord; count: number }
    >();
    const years = new Map<number, number>();
    return {
      add(page) {
        const counts = new Map<
          string,
          { record: VinplusRecord; count: number }
        >();
        for (const record of page) {
          const key = JSON.stringify(vinplusStableRecord(record));
          counts.set(key, { record, count: (counts.get(key)?.count ?? 0) + 1 });
        }
        for (const [key, value] of counts) {
          const prior = retained.get(key)?.count ?? 0;
          if (value.count > prior) {
            retained.set(key, value);
            years.set(
              value.record.year,
              (years.get(value.record.year) ?? 0) + value.count - prior,
            );
          }
        }
      },
      yearCount: (year) => years.get(year) ?? 0,
      records: () =>
        [...retained.values()].flatMap((value) =>
          Array.from({ length: value.count }, () => value.record),
        ),
    };
  },
} as const;
