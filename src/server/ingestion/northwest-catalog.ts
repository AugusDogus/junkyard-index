import type { NorthwestControl, NorthwestPage } from "./northwest-parser";
import { NorthwestSnapshot } from "./northwest-snapshot";
import { NORTHWEST_YARD } from "./northwest-yard-metadata";

export interface NorthwestMake extends NorthwestControl {
  models: NorthwestControl[] | null;
}
export const northwestModels = (makes: readonly NorthwestMake[]) =>
  makes.flatMap((make) =>
    (make.models ?? []).map((model) => ({ make, model })),
  );

export function northwestSnapshot(
  makes: readonly NorthwestMake[],
  pages: readonly NorthwestPage[],
) {
  const models = northwestModels(makes);
  if (pages.length !== models.length)
    throw new Error("Northwest snapshot is missing published model evidence");
  const result = NorthwestSnapshot.fromNativeRecords(
    pages.flatMap((page) => page.records),
    {
      code: NORTHWEST_YARD.code,
      name: NORTHWEST_YARD.name,
      city: NORTHWEST_YARD.city,
      lat: NORTHWEST_YARD.lat,
      lng: NORTHWEST_YARD.lng,
    },
  );
  if (!result.ok) throw new Error(result.error.detail);
  const snapshot = result.value;
  const warnings: string[] = [];
  let missingDonors = 0;
  models.forEach(({ make, model }, index) => {
    const page = pages[index];
    if (!page)
      throw new Error("Northwest model is missing native page evidence");
    const observed = page.records.length;
    if (model.count !== observed) {
      missingDonors += Math.max(0, model.count - observed);
      warnings.push(
        `Northwest ${make.label} / ${model.label}: badge advertises ${model.count}, found ${observed}, unrecovered ${Math.max(0, model.count - observed)}.`,
      );
    }
  });
  // Make badges describe the same donors. Count only additional deficits beyond
  // those already represented by model badges, never the same missing car twice.
  for (const make of makes) {
    if (make.models === null)
      throw new Error("Northwest make has unread models");
    const advertised = make.models.reduce((sum, model) => sum + model.count, 0);
    if (make.count !== advertised) {
      missingDonors += Math.max(0, make.count - advertised);
      warnings.push(
        `Northwest ${make.label}: make badge advertises ${make.count}, model badges sum to ${advertised}; additional unrecovered ${Math.max(0, make.count - advertised)}.`,
      );
    }
  }
  const denominator = snapshot.accounting.recordsProcessed;
  warnings.push(
    `Northwest unrecovered advertised donors: ${missingDonors} / ${denominator} observed (${denominator ? ((100 * missingDonors) / denominator).toFixed(6) : "undefined"}%). Limit 1%.`,
  );
  const accepted = new Set(snapshot.candidates.map((v) => v.vin));
  return {
    vehicles: snapshot.candidates,
    observedVins: snapshot.observedVins.filter((vin) => !accepted.has(vin)),
    accounting: snapshot.accounting,
    quality: snapshot.quality,
    missingDonors,
    warnings,
  };
}
export function validateNorthwestSnapshot(
  snapshot: ReturnType<typeof northwestSnapshot>,
) {
  if (
    snapshot.quality.issues.length ||
    snapshot.vehicles.length < 2_229 ||
    snapshot.missingDonors > snapshot.accounting.recordsProcessed * 0.01
  )
    throw new Error(
      `Northwest complete graph failed admission: ${snapshot.missingDonors} unrecovered advertised donors / ${snapshot.accounting.recordsProcessed} observed (limit 1%); ${snapshot.accounting.recordsRejected} rejects; ${snapshot.vehicles.length} accepted (minimum 2229). Preserve prior inventory and inspect saved native evidence.`,
    );
}
