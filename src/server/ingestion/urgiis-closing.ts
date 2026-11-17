import { z } from "zod";
import { URGIIS_EMPTY_MODEL_MINIMUM } from "./urgiis-schema";
import { urgiisEntryFingerprint, type UrgiisEntry } from "./urgiis-traversal";

export const UrgiisBadgeDriftSchema = z
  .object({
    makes: z.number().int().nonnegative(),
    models: z.number().int().nonnegative(),
  })
  .strict();
export type UrgiisBadgeDrift = z.infer<typeof UrgiisBadgeDriftSchema>;

/** Badges can describe shared pools and part bins, so use the enumerated native
 * model cards, never the advertised totals, for Hollander's 3-or-1% allowance.
 * Track each directory level separately to avoid counting a car twice.
 */
export function urgiisBadgeLimit(entries: readonly UrgiisEntry[]) {
  const cards = entries.reduce(
    (total, entry) =>
      total + (entry.kind === "model" ? entry.records.length : 0),
    0,
  );
  return Math.max(3, Math.floor(cards * 0.01));
}

export function urgiisClosingEvidence(
  opening: UrgiisEntry | undefined,
  closing: UrgiisEntry,
  entries: readonly UrgiisEntry[],
  previous: UrgiisBadgeDrift,
):
  | { kind: "valid"; badgeDrift: UrgiisBadgeDrift }
  | { kind: "drift"; message: string } {
  const drift = (message: string) => ({ kind: "drift" as const, message });
  if (
    !opening ||
    opening.kind !== closing.kind ||
    opening.url !== closing.url ||
    urgiisEntryFingerprint(opening) !== urgiisEntryFingerprint(closing)
  )
    return drift(
      "Official ownership claims, literal directory paths or labels changed",
    );
  if (!("controls" in opening) || !("controls" in closing))
    return { kind: "valid", badgeDrift: previous };
  let changed = 0;
  for (const [i, control] of closing.controls.entries()) {
    const before = opening.controls[i];
    if (!before)
      return drift("Published directory control appeared during closing");
    const growth = Math.max(0, control.count - before.count);
    changed += Math.abs(control.count - before.count);
    if (closing.kind === "menu" && growth > 0) {
      const observed = entries.find(
        (entry) =>
          entry.kind === "model" &&
          entry.url === new URL(control.path, closing.url).href,
      );
      if (
        !observed ||
        !("records" in observed) ||
        control.count >= 500 ||
        observed.records.length + growth >= 500
      )
        return drift(
          "Growing model may cross the native 500-card boundary at " +
            control.path,
        );
      if (
        observed.records.length === 0 &&
        control.count >= URGIIS_EMPTY_MODEL_MINIMUM
      )
        return drift(
          "Growing model advertises " +
            control.count +
            " donors after an explicit empty result at " +
            control.path,
        );
    }
  }
  const level = closing.kind === "makes" ? "makes" : "models";
  const badgeDrift = { ...previous, [level]: previous[level] + changed };
  const limit = urgiisBadgeLimit(entries);
  if (badgeDrift[level] > limit)
    return drift(
      `${level} badges changed by ${badgeDrift[level]}, above the tenant limit ${limit}`,
    );
  return { kind: "valid", badgeDrift };
}
