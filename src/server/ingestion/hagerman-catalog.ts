import { createHash } from "node:crypto";
import { SourceValidationPolicy } from "./source-validation";
import {
  assessHagermanDonor,
  type HagermanAssessment,
} from "./hagerman-transform";
import type { HagermanDonor, HagermanPage } from "./hagerman-parser";

export function hagermanPageHash(page: HagermanPage): string {
  return createHash("sha256").update(JSON.stringify(page)).digest("hex");
}
function assess(
  page: HagermanPage,
  donors: readonly HagermanDonor[],
): HagermanAssessment[] {
  if (donors.length !== page.total)
    throw new Error("Hagerman complete primary donor assessments are missing");
  const records = page.members.map((member, index) => {
    const donor = donors[index];
    if (!donor || donor.id !== member.id || donor.url !== member.url)
      throw new Error(
        "Hagerman primary detail membership skips, repeats or changes ordered native destinations",
      );
    return assessHagermanDonor(member, donor);
  });
  const counts = new Map<string, number>();
  for (const record of records)
    if (record.vin) counts.set(record.vin, (counts.get(record.vin) ?? 0) + 1);
  return records.map(
    (record): HagermanAssessment =>
      record.vin && (counts.get(record.vin) ?? 0) > 1
        ? {
            status: "rejected",
            donor: record.donor,
            vin: record.vin,
            reasons: [
              ...(record.status === "rejected" ? record.reasons : []),
              "conflicting-native-identity-destinations",
            ],
          }
        : record,
  );
}
function quality(
  page: HagermanPage,
  donors: readonly HagermanDonor[],
  previousAcceptedCount: number | null,
) {
  const records = assess(page, donors);
  const accepted = records.filter((record) => record.status === "accepted");
  const rejected = records.length - accepted.length;
  if (
    !accepted.length ||
    rejected / records.length > SourceValidationPolicy.maximumRejectionRatio ||
    (previousAcceptedCount !== null &&
      accepted.length <
        Math.floor(
          previousAcceptedCount *
            SourceValidationPolicy.minimumPreviousRunRatio,
        ))
  )
    throw new Error(
      "Complete Hagerman census fails unchanged required-field rejection or previous-inventory drift guards",
    );
  return { records, accepted, rejected };
}
export const HagermanCensus = { assess, quality } as const;
