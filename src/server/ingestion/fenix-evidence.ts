import type { FenixEntry, FenixPageEvidence } from "./fenix-cursor";
import { FenixDonor } from "./fenix-donor";
import type { FenixYardCode } from "./fenix-yard-metadata";
import { SourceValidationPolicy } from "./source-validation";

export function validateFenixYardEvidence(
  entries: FenixEntry[],
  pages: FenixPageEvidence[],
  yard: FenixYardCode,
) {
  const donors = entries.filter((entry) => entry.yard === yard);
  const totals = (["DESC", "ASC"] as const).map((order) =>
    pages
      .filter((page) => page.yard === yard && page.order === order)
      .reduce((count, page) => count + page.ids.length, 0),
  );
  if (!totals[0] || totals[0] !== totals[1] || donors.length !== totals[0])
    throw new Error(
      `Both native date orders must recover the exact published census for ${yard}: union=${donors.length}, DESC=${totals[0]}, ASC=${totals[1]}`,
    );
  const rejected = donors.filter(
    (entry) => FenixDonor.parse(entry.record).status === "incomplete",
  ).length;
  if (
    rejected === donors.length ||
    rejected / donors.length > SourceValidationPolicy.maximumRejectionRatio
  )
    throw new Error(
      `Per-yard quality failed for ${yard}: ${rejected} rejected of ${donors.length}; retain the 10% rejection limit`,
    );
  for (const order of ["DESC", "ASC"] as const) {
    const ids = pages
      .filter((page) => page.yard === yard && page.order === order)
      .flatMap((page) => page.ids);
    if (
      (ids.length - new Set(ids).size) / ids.length >
      SourceValidationPolicy.maximumDuplicateRatio
    )
      throw new Error(`Fenix ${yard} ${order} duplicate ratio exceeds 25%`);
  }
}
