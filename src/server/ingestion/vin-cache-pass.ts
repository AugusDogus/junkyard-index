export type VinCachePassState = { cursor: string | null; accepted: number };
export type VinCacheBatch = {
  status: "complete" | "pending" | "unavailable";
  state: VinCachePassState;
};

/** A failed batch opens the circuit for the entire pass, including later steps. */
export async function runVinCachePass(
  batch: (state: VinCachePassState) => Promise<VinCacheBatch>,
) {
  let state: VinCachePassState = { cursor: null, accepted: 0 };
  while (true) {
    const result = await batch(state);
    state = result.state;
    if (result.status !== "pending") return { status: result.status, ...state };
  }
}
