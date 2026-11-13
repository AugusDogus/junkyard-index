import type { BrandywineRecord } from "./brandywine-record";

/** Reconcile identity, destination, YMM, yard and activity before exclusions. */
export function classifyBrandywineSnapshot(records: BrandywineRecord[]) {
  const groups = new Map<string, BrandywineRecord[]>();
  for (const record of records) {
    const keys = [
      ...record.validVinClaims.map((vin) => "vin:" + vin),
      ...record.claimedDestinations.map((url) => "url:" + url),
      ...record.bindings.map((binding) => "stock:" + binding.stock),
    ];
    for (const key of new Set(keys))
      groups.set(key, [...(groups.get(key) ?? []), record]);
  }
  const quarantined = new Set<BrandywineRecord>(
    records.filter((record) => record.status !== "required-pass"),
  );
  for (const group of groups.values()) {
    const signatures = new Set(
      group.map((record) =>
        JSON.stringify([
          record.validVinClaims,
          record.claimedDestinations,
          record.candidate?.year,
          record.candidate?.make,
          record.candidate?.model,
          record.bindings.map((b) => b.yard),
          /^(?:CRUSHED|SOLD)$/.test(record.marker) ? "inactive" : "active",
        ]),
      ),
    );
    if (signatures.size > 1)
      for (const record of group) quarantined.add(record);
  }
  let before = -1;
  while (before !== quarantined.size) {
    before = quarantined.size;
    for (const group of groups.values())
      if (group.some((record) => quarantined.has(record)))
        for (const record of group) quarantined.add(record);
  }
  const candidates = new Map<
    string,
    NonNullable<BrandywineRecord["candidate"]>
  >();
  const exclusions: BrandywineRecord[] = [];
  const rejected: BrandywineRecord[] = [];
  let duplicates = 0;
  for (const record of records) {
    if (quarantined.has(record) || record.status !== "required-pass")
      rejected.push(record);
    else if (record.marker === "CRUSHED" || record.marker === "SOLD")
      exclusions.push(record);
    else if (candidates.has(record.candidate.vin)) duplicates++;
    else candidates.set(record.candidate.vin, record.candidate);
  }
  const allValidVins = [
    ...new Set(records.flatMap((r) => r.validVinClaims)),
  ].sort();
  const inactive = new Set(
    exclusions.flatMap((record) => record.validVinClaims),
  );
  return {
    candidates: [...candidates.values()],
    exclusions,
    rejected,
    duplicateExtras: duplicates,
    observedValidVins: allValidVins,
    presentVins: allValidVins.filter((vin) => !inactive.has(vin)),
    recordsProcessed: records.length,
  };
}
