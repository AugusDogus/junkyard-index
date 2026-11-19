/** Lightweight candidates, before fetching full vehicle details. */
export type ModelArrivalCandidate = {
  vin: string;
  source: string;
  code: string;
  imageUrl: string | null;
  addedAt: number;
};

export const ModelArrivals = {
  /** Photos first, then one per yard before repeats; newest within each round. */
  pick<Candidate extends ModelArrivalCandidate>(
    candidates: readonly Candidate[],
    count: number,
  ): Candidate[] {
    const perYard = new Map<string, number>();
    return [...candidates]
      .sort((a, b) => b.addedAt - a.addedAt || a.vin.localeCompare(b.vin))
      .map((candidate) => {
        const hasPhoto = Boolean(candidate.imageUrl?.trim());
        const key = JSON.stringify([
          hasPhoto,
          candidate.source,
          candidate.code,
        ]);
        const yardRank = perYard.get(key) ?? 0;
        perYard.set(key, yardRank + 1);
        return { candidate, hasPhoto, yardRank };
      })
      .sort(
        (a, b) =>
          Number(b.hasPhoto) - Number(a.hasPhoto) ||
          a.yardRank - b.yardRank ||
          b.candidate.addedAt - a.candidate.addedAt ||
          a.candidate.vin.localeCompare(b.candidate.vin),
      )
      .slice(0, count)
      .map(({ candidate }) => candidate);
  },
} as const;
