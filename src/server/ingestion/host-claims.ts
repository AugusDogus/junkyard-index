// Pure: the ingestion pass workflow runs this in the workflow sandbox.

/**
 * What a source run occupies while it fetches: shared host lanes, each paced
 * for one source at a time, and one place in each capped group it uses (the
 * URG central API). The daily pass
 * starts a fetching run only when its claims are free, so requests to a shared
 * host are paced inside one process and never coordinated across runs.
 */
export interface HostClaims {
  readonly lanes: readonly string[];
  readonly places: readonly HostPlace[];
}

/** One place among a group's `capacity`. */
export interface HostPlace {
  readonly group: string;
  readonly capacity: number;
}

export const HostClaims = {
  none: { lanes: [], places: [] } satisfies HostClaims,

  isNone(claims: HostClaims): boolean {
    return claims.lanes.length === 0 && claims.places.length === 0;
  },

  /** Whether a run holding `held` already occupies everything in `needed`. */
  covers(held: HostClaims, needed: HostClaims): boolean {
    return (
      needed.lanes.every((lane) => held.lanes.includes(lane)) &&
      needed.places.every(({ group }) =>
        held.places.some((place) => place.group === group),
      )
    );
  },

  equal(a: HostClaims, b: HostClaims): boolean {
    return HostClaims.covers(a, b) && HostClaims.covers(b, a);
  },

  /**
   * The runs from `queued` that may start now beside the runs `held` claims,
   * in queue order. A run that must wait does not hold back a later run whose
   * claims are free.
   */
  admit<Run extends { readonly claims: HostClaims }>(
    queued: readonly Run[],
    held: readonly HostClaims[],
  ): Run[] {
    const lanes = new Set<string>();
    const places = new Map<string, number>();
    const take = (claims: HostClaims) => {
      for (const lane of claims.lanes) lanes.add(lane);
      for (const { group } of claims.places)
        places.set(group, (places.get(group) ?? 0) + 1);
    };
    held.forEach(take);
    return queued.filter(({ claims }) => {
      const free =
        claims.lanes.every((lane) => !lanes.has(lane)) &&
        claims.places.every(
          ({ group, capacity }) => (places.get(group) ?? 0) < capacity,
        );
      if (free) take(claims);
      return free;
    });
  },
} as const;
