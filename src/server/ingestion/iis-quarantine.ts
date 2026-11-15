import type { IisAssessment } from "./iis-record";
type Groups = Map<string, Set<number>>;
const add = (groups: Groups, key: string, index: number) => {
  const group = groups.get(key) ?? new Set<number>();
  group.add(index);
  groups.set(key, group);
};

export function quarantineIisClaims(assessments: readonly IisAssessment[]) {
  const vins: Groups = new Map(),
    destinations: Groups = new Map();
  const quarantine = new Set<number>();
  assessments.forEach((row, index) => {
    for (const vin of row.validVinClaims) add(vins, vin, index);
    for (const destination of row.nativeClaims.destinations)
      add(destinations, destination, index);
    if (
      row.reasons.includes("conflicting-native-required-claims") ||
      row.validVinClaims.length > 1 ||
      row.nativeClaims.destinations.length > 1
    )
      quarantine.add(index);
  });
  const conflicts: {
    domain: "vin" | "destination";
    value: string;
    recordIndices: number[];
  }[] = [];
  for (const [domain, groups] of [
    ["vin", vins],
    ["destination", destinations],
  ] as const) {
    for (const [value, indices] of groups) {
      const claims = {
        years: new Set<string>(),
        makeModels: new Set<string>(),
        vins: new Set<string>(),
        destinations: new Set<string>(),
      };
      for (const index of indices) {
        const row = assessments[index];
        if (!row)
          throw new Error(
            "IIS native conflict group references a missing assessed row",
          );
        for (const key of [
          "years",
          "makeModels",
          "vins",
          "destinations",
        ] as const)
          for (const claim of row.nativeClaims[key])
            if (claim.trim())
              claims[key].add(key === "vins" ? claim.toUpperCase() : claim);
      }
      if (Object.values(claims).some((group) => group.size > 1)) {
        conflicts.push({ domain, value, recordIndices: [...indices] });
        for (const index of indices) quarantine.add(index);
      }
    }
  }
  let previous = -1;
  while (previous !== quarantine.size) {
    previous = quarantine.size;
    for (const groups of [vins, destinations])
      for (const indices of groups.values())
        if ([...indices].some((index) => quarantine.has(index)))
          for (const index of indices) quarantine.add(index);
  }
  return { quarantine, conflicts };
}
