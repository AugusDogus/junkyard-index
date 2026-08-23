export class QuarantinedAlertMatchError extends Error {
  override readonly name = "QuarantinedAlertMatchError";
}

export async function processAlertMatchBatch<Search extends { id: string }>(
  searches: readonly Search[],
  operations: {
    match: (search: Search) => Promise<number>;
    recordFailure: (search: Search, error: unknown) => Promise<void>;
  },
): Promise<number> {
  let intentsCreated = 0;
  for (const search of searches) {
    try {
      intentsCreated += await operations.match(search);
    } catch (error) {
      if (!(error instanceof QuarantinedAlertMatchError)) throw error;
      await operations.recordFailure(search, error);
    }
  }
  return intentsCreated;
}
