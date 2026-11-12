import { z } from "zod";
import type { DdautoRecord } from "./ddauto-transform";
import { DDAUTO_DOCUMENT_ROOT } from "./ddauto-yard-metadata";

export const DDAUTO_MAX_NATIVE_ROWS = 500;
export const DDAUTO_QUERY_BODY = JSON.stringify({
  structuredQuery: {
    from: [{ collectionId: "rows" }],
    orderBy: [{ field: { fieldPath: "__name__" }, direction: "ASCENDING" }],
    limit: DDAUTO_MAX_NATIVE_ROWS + 1,
  },
});
const scalarSchema = z.union([
  z
    .object({ stringValue: z.string().max(10_000) })
    .strict()
    .transform((v) => v.stringValue),
  z
    .object({ integerValue: z.string().regex(/^-?\d+$/) })
    .strict()
    .transform((v) => v.integerValue),
  z
    .object({ doubleValue: z.number().finite() })
    .strict()
    .transform((v) => String(v.doubleValue)),
]);
const scalar = (fields: Record<string, unknown>, key: string) => {
  const parsed = scalarSchema.safeParse(fields[key]);
  return parsed.success ? parsed.data.replace(/\\n|\s+/g, " ").trim() : "";
};
const statusSchema = z.enum([
  "Parts",
  "Premium Lot",
  "NOT AVAILABLE",
  "Killed",
]);
interface Counts {
  total: number;
  parts: number;
  premium: number;
  allParts: number;
  inactive: number;
}
const emptyCounts = (): Counts => ({
  total: 0,
  parts: 0,
  premium: 0,
  allParts: 0,
  inactive: 0,
});
function increment(counts: Counts, status: DdautoRecord["status"]) {
  counts.total++;
  if (status === "Parts") counts.parts++;
  if (status === "Premium Lot") counts.premium++;
  if (status === "Parts" || status === "Premium Lot") counts.allParts++;
  else counts.inactive++;
}
const equalCounts = (a: Counts, b: Counts) =>
  a.total === b.total &&
  a.parts === b.parts &&
  a.premium === b.premium &&
  a.allParts === b.allParts &&
  a.inactive === b.inactive;

/** A single public Firestore query supplies a consistent readTime and no continuation.
 * Request one over the supported bound so a capped response cannot look terminal.
 * Native make/status totals independently reconcile every nonblank donor row.
 */
export function parseDdautoRows(
  raw: string,
  colorColumn: "FYX7j" | null = null,
) {
  const entries = z
    .array(
      z
        .object({
          document: z
            .object({
              name: z.string().max(500),
              fields: z.record(z.unknown()),
              createTime: z.string().datetime(),
              updateTime: z.string().datetime(),
            })
            .strict(),
          readTime: z.string().datetime(),
        })
        .strict(),
    )
    .min(1)
    .max(DDAUTO_MAX_NATIVE_ROWS + 1)
    .parse(JSON.parse(raw));
  if (entries.length > DDAUTO_MAX_NATIVE_ROWS)
    throw new Error(
      "DD Auto native table reached the query bound; complete enumeration is unproven",
    );
  const readTime = entries[0]?.readTime;
  const records: DdautoRecord[] = [];
  const rowIds = new Set<string>();
  const rowIndexes = new Set<string>();
  const controls = new Map<string, Counts>();
  const actual = new Map<string, Counts>();
  const totals = emptyCounts();
  let previousName = "";
  for (const entry of entries) {
    const { name, fields } = entry.document;
    const id = name.slice((DDAUTO_DOCUMENT_ROOT + "/rows/").length);
    const rowId = scalar(fields, "$rowID");
    const rowIndex = scalar(fields, "$rowIndex");
    if (
      entry.readTime !== readTime ||
      !name.startsWith(DDAUTO_DOCUMENT_ROOT + "/rows/") ||
      !/^[a-zA-Z0-9]{20}$/.test(id) ||
      name <= previousName ||
      !/^[a-zA-Z0-9_.-]{1,100}$/.test(rowId) ||
      rowIds.has(rowId) ||
      !/^[a-zA-Z0-9]{1,100}$/.test(rowIndex) ||
      rowIndexes.has(rowIndex) ||
      !/^\d+$/.test(scalar(fields, "$rowVersion")) ||
      "$deleted" in fields
    )
      throw new Error(
        "DD Auto query identity, ordering, deletion state or consistent readTime changed",
      );
    previousName = name;
    rowIds.add(rowId);
    rowIndexes.add(rowIndex);
    const label = scalar(fields, "jWUbL");
    const countFields = ["nWiGd", "0i78o", "O7OdI", "3mHdV", "M0XG2"];
    if (label || countFields.some((key) => key in fields)) {
      const values = countFields.map((key) => scalar(fields, key));
      if (
        !label ||
        controls.has(label) ||
        values.some(
          (v) => !/^\d+$/.test(v) || Number(v) > DDAUTO_MAX_NATIVE_ROWS,
        )
      )
        throw new Error(
          "DD Auto native make/status count directory is incomplete or ambiguous",
        );
      controls.set(label, {
        total: Number(values[0]),
        parts: Number(values[1]),
        premium: Number(values[2]),
        allParts: Number(values[3]),
        inactive: Number(values[4]),
      });
    }
    const year = scalar(fields, "Mp2MG"),
      make = scalar(fields, "hWp9i"),
      model = scalar(fields, "JlJgo");
    const vin = scalar(fields, "cnfEv"),
      rawColor = scalar(fields, "FYX7j"),
      color = colorColumn === "FYX7j" ? rawColor : "",
      nativeStatus = scalar(fields, "3cf4t");
    if (
      ![
        year,
        make,
        model,
        vin,
        rawColor,
        nativeStatus,
        scalar(fields, "Sflni"),
      ].some(Boolean)
    )
      continue;
    const status = statusSchema.parse(nativeStatus);
    records.push({ id, rowId, year, make, model, vin, color, status });
    const counts = actual.get(make) ?? emptyCounts();
    increment(counts, status);
    actual.set(make, counts);
    increment(totals, status);
  }
  const total = controls.get("Total");
  if (
    !total ||
    records.length === 0 ||
    records.length > 300 ||
    !equalCounts(total, totals) ||
    [...actual].some(
      ([make, counts]) =>
        !equalCounts(controls.get(make) ?? emptyCounts(), counts),
    ) ||
    [...controls].some(
      ([make, counts]) =>
        make !== "Total" &&
        !equalCounts(actual.get(make) ?? emptyCounts(), counts),
    )
  )
    throw new Error(
      "DD Auto full inventory does not reconcile with every native make/status total or exceeds the verified public view",
    );
  return {
    records,
    readTime,
    nativeDocuments: entries.length,
    blankDocuments: entries.length - records.length,
  };
}
