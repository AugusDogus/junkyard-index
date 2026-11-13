import {
  isRohnerArticleUrl,
  type RohnerArticleResult,
  type RohnerCandidate,
} from "./rohner-record";

export function classifyRohnerSnapshot(results: RohnerArticleResult[]) {
  const groups = new Map<string, typeof results>();
  for (const result of results)
    for (const vin of result.validVinClaims)
      groups.set(vin, [...(groups.get(vin) ?? []), result]);
  const quarantined = new Set<string>();
  for (const [vin, group] of groups) {
    const identities = new Set(
      group.map((result) =>
        JSON.stringify([
          result.detailsUrl,
          result.candidate?.year,
          result.candidate?.make,
          result.candidate?.model,
        ]),
      ),
    );
    if (
      identities.size > 1 ||
      group.some((result) => result.status !== "required-pass")
    )
      quarantined.add(vin);
  }
  const destinationGroups = new Map<string, typeof results>();
  for (const result of results)
    for (const destination of result.claimedDestinations)
      if (isRohnerArticleUrl(destination))
        destinationGroups.set(destination, [
          ...(destinationGroups.get(destination) ?? []),
          result,
        ]);
  let previousSize = -1;
  while (previousSize !== quarantined.size) {
    previousSize = quarantined.size;
    for (const group of destinationGroups.values()) {
      const identities = new Set(
        group.map((result) =>
          JSON.stringify([
            result.validVinClaims,
            result.candidate?.year,
            result.candidate?.make,
            result.candidate?.model,
          ]),
        ),
      );
      if (
        identities.size > 1 ||
        group.some(
          (result) =>
            result.status !== "required-pass" ||
            result.validVinClaims.some((vin) => quarantined.has(vin)),
        )
      )
        for (const result of group)
          for (const vin of result.validVinClaims) quarantined.add(vin);
    }
  }
  const candidates = new Map<string, RohnerCandidate>();
  const rejected: typeof results = [];
  let duplicates = 0;
  for (const result of results) {
    const candidate = result.candidate;
    if (
      result.status !== "required-pass" ||
      candidate === null ||
      result.validVinClaims.some((vin) => quarantined.has(vin))
    )
      rejected.push(result);
    else if (candidates.has(candidate.vin)) duplicates++;
    else candidates.set(candidate.vin, candidate);
  }
  const exclusions = new Map<
    string,
    {
      reason: "sold-rebuilder";
      candidate: RohnerCandidate;
      claims: { boundary: string; value: string }[];
    }
  >();
  for (const result of results) {
    if (
      result.status !== "required-pass" ||
      result.validVinClaims.some((vin) => quarantined.has(vin))
    )
      continue;
    const claims = result.nativeNamedClaims.filter(
      (claim) =>
        /\bsold[- ]rebuilder\b/i.test(claim.value) &&
        /^(?:document-title|og:title|summary-\d+-(?:h1|breadcrumb-leaf)|.*:title)$/.test(
          claim.boundary,
        ),
    );
    if (claims.length)
      exclusions.set(result.candidate.vin, {
        reason: "sold-rebuilder",
        candidate: result.candidate,
        claims,
      });
  }
  return {
    candidates: [...candidates.values()].filter(
      (candidate) => !exclusions.has(candidate.vin),
    ),
    exclusions: [...exclusions.values()],
    rejected,
    duplicateExtras: duplicates,
    quarantinedVins: [...quarantined].sort(),
    observedValidVins: [...groups.keys()].sort(),
    // An intentional whole-vehicle sale exclusion may retire a direct mirror.
    // A rejected/conflicting identity still protects every observed valid VIN.
    presentVins: [...groups.keys()]
      .filter((vin) => !exclusions.has(vin))
      .sort(),
    recordsProcessed: results.length,
  };
}
