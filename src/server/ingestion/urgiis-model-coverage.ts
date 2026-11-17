import type { UrgiisControl } from "./urgiis-schema";
import type { UrgiisEntry } from "./urgiis-traversal";

/** IIS publishes ampersands as -and, and leaves periods/parentheses in model
 * slugs. Saved native routes and encoding probes establish this broken shape.
 * Ordinary names (including the word AND) never qualify by tenant or model list. */
export function urgiisBrokenModelRoute(model: UrgiisControl) {
  const slug = model.path.split("/").filter(Boolean).at(-1) ?? "";
  return (
    /[&.(]/.test(model.label) ||
    /(?:(?:^|_)-and(?:_|$)|[&.(]|%26|%2e|%28)/i.test(slug)
  );
}

export function urgiisModelCoverage(
  entries: readonly UrgiisEntry[],
  closingModels?: readonly UrgiisControl[],
) {
  const models =
    closingModels ??
    entries.flatMap((e) => (e.kind === "menu" ? e.controls : []));
  const advertised = models.reduce((n, m) => n + m.count, 0);
  const unreachable = models.filter(
    (model) =>
      model.count > 0 &&
      urgiisBrokenModelRoute(model) &&
      entries.some(
        (e) =>
          e.kind === "model" &&
          new URL(e.url).pathname === model.path &&
          e.records.length === 0 &&
          e.freshness.kind !== "retry",
      ),
  );
  const count = unreachable.reduce((n, m) => n + m.count, 0);
  return {
    advertised,
    unreachable,
    count,
    blocked: count * 100 > advertised,
    message: `${count}/${advertised} advertised donors are platform-unreachable (${unreachable.map((m) => `${m.label}: ${m.count} [${m.path}]`).join(", ")}); maximum is 1%`,
  };
}
