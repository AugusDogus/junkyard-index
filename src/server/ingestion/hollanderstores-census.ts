import {
  HollanderstoresRowSchema,
  type HollanderstoresPage,
  type HollanderstoresRow,
} from "./hollanderstores-parser";

const rowFields = HollanderstoresRowSchema.keyof().options;

function fieldValue(row: HollanderstoresRow, field: keyof HollanderstoresRow) {
  const value = row[field];
  return value === undefined ? "absent" : JSON.stringify(value);
}

/** Bound identity turnover, not just net count change. The saved drift-history
 * captures lose 1-3 vehicles per yard. Allow 3 or 1% (rounded down), whichever
 * is larger, while retaining the fully enumerated opening set for publication.
 */
export function hollanderstoresCensusError(
  opening: HollanderstoresPage,
  closing: HollanderstoresPage,
): string | null {
  const openingUrls = new Set(opening.rows.map((row) => row.url));
  const closingUrls = new Set(closing.rows.map((row) => row.url));
  const removed = opening.rows.filter((row) => !closingUrls.has(row.url));
  const added = closing.rows.filter((row) => !openingUrls.has(row.url));
  const limit = Math.max(3, Math.floor(opening.total * 0.01));
  if (removed.length + added.length > limit)
    return `${opening.yard} closing census drift exceeds ${limit} vehicles: ${removed.length} removed, ${added.length} added (${opening.total} opening, ${closing.total} closing). Previous inventory and the last validated checkpoint are preserved. Inspect the captures and restart with a fresh opening census.`;
  // Turnover may add or remove rows, but surviving records must retain their
  // fields, destinations and relative order. Reordered duplicate stocks remain
  // unqualified, as in the saved OK Auto Parts captures.
  const openingSurvivors = opening.rows.filter((row) =>
    closingUrls.has(row.url),
  );
  const closingSurvivors = closing.rows.filter((row) =>
    openingUrls.has(row.url),
  );
  if (JSON.stringify(openingSurvivors) === JSON.stringify(closingSurvivors))
    return null;
  // The rest only explains the rejection: which fields changed, where order
  // first diverges, and how many surviving positions differ.
  const closingByUrl = new Map(closingSurvivors.map((row) => [row.url, row]));
  const fieldChanges = openingSurvivors.flatMap((before) => {
    const after = closingByUrl.get(before.url);
    if (!after) return [];
    const fields = rowFields.filter(
      (field) => fieldValue(before, field) !== fieldValue(after, field),
    );
    return fields.length === 0 ? [] : [{ before, after, fields }];
  });
  const firstChange = fieldChanges[0];
  const fieldPart = firstChange
    ? `${fieldChanges.length} surviving ${fieldChanges.length === 1 ? "vehicle" : "vehicles"} changed fields, first ${firstChange.before.url} changed ` +
      firstChange.fields
        .map(
          (field) =>
            `${field} from ${fieldValue(firstChange.before, field)} to ${fieldValue(firstChange.after, field)}`,
        )
        .join(", ")
    : "no surviving vehicle fields changed";
  const position = openingSurvivors.findIndex(
    (row, index) => row.url !== closingSurvivors[index]?.url,
  );
  const openingAt = openingSurvivors[position];
  const closingAt = closingSurvivors[position];
  // Stock and VIN show whether a reorder only swapped cards sharing a stock.
  const orderPart =
    !openingAt || !closingAt
      ? "relative order is unchanged"
      : `order changed, first at surviving position ${position}: opening has ${openingAt.url} (stock ${JSON.stringify(openingAt.stock)}, VIN ${JSON.stringify(openingAt.vin)}), closing has ${closingAt.url} (stock ${JSON.stringify(closingAt.stock)}, VIN ${JSON.stringify(closingAt.vin)}), ${openingAt.stock === closingAt.stock ? "same stock" : "different stocks"}`;
  const differing = openingSurvivors.filter(
    (row, index) =>
      JSON.stringify(row) !== JSON.stringify(closingSurvivors[index]),
  ).length;
  return `${opening.yard} closing census changed surviving vehicle fields or order: ${fieldPart}; ${orderPart} (${differing} of ${openingSurvivors.length} surviving positions differ). Previous inventory and the last validated checkpoint are preserved. Compare these vehicles in the opening and closing captures, then restart with a fresh opening census.`;
}
