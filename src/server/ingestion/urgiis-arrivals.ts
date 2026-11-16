import type { UrgiisRecord } from "./urgiis-schema";
import type { UrgiisEntry } from "./urgiis-traversal";

export const urgiisDonorIdentity = (record: UrgiisRecord) =>
  JSON.stringify({
    stock: record.stock,
    vins: record.vins.map((v) => v.trim().toUpperCase()).sort(),
  });

/** Native day precision only. Never infer an entry timestamp from stock order. */
export function urgiisArrivalDate(record: UrgiisRecord): number | null {
  const raw = record.purchaseDate ?? record.date;
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const date = new Date(raw + "T00:00:00Z");
  return Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === raw
    ? date.getTime()
    : null;
}

/** Overlap is a limited window check, not proof against backdated insertions. */
export function urgiisArrivalsCoverage(
  entries: readonly UrgiisEntry[],
  previous: { acceptedAt: number; entries: readonly UrgiisEntry[] } | undefined,
):
  | { kind: "usable" }
  | { kind: "overflow"; reason: "all-new" | "newer-oldest" } {
  const arrivals = entries.find((e) => e.kind === "arrivals");
  if (!previous || arrivals?.kind !== "arrivals" || !arrivals.records.length)
    return { kind: "usable" };
  const known = new Set(
    previous.entries.flatMap((e) =>
      "records" in e ? e.records.map(urgiisDonorIdentity) : [],
    ),
  );
  if (arrivals.records.every((r) => !known.has(urgiisDonorIdentity(r))))
    return { kind: "overflow", reason: "all-new" };
  const dates = arrivals.records.map(urgiisArrivalDate);
  // Undated rows cannot establish the oldest date. In that case retain the
  // identity-overlap check and the explicit seven-day backdating limitation.
  if (
    dates.every((date) => date !== null) &&
    Math.min(...dates) > previous.acceptedAt
  )
    return { kind: "overflow", reason: "newer-oldest" };
  return { kind: "usable" };
}
