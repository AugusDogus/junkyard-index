/** The part of a workflow hook the writer lock uses. */
export interface AlgoliaWriterHook extends Disposable {
  /** The run already holding the token, or null once this hook holds it. */
  getConflict(): Promise<{ runId: string } | null>;
}

/**
 * Runs `write` while holding the `algolia-writes` hook, so only one workflow
 * writes the search index at a time. While another run holds it, waits and
 * retries with a fresh hook. The hook is disposed, releasing the lock, only
 * after `write` resolves or rejects.
 */
export async function withAlgoliaWriterLock<T>(operations: {
  acquire: () => AlgoliaWriterHook;
  waitForWriter: (activeRunId: string) => Promise<void>;
  write: () => Promise<T>;
}): Promise<T> {
  while (true) {
    using lock = operations.acquire();
    const activeWriter = await lock.getConflict();
    if (activeWriter) {
      await operations.waitForWriter(activeWriter.runId);
      continue;
    }
    // A bare `return write()` would dispose the lock before `write` settles.
    return await operations.write();
  }
}
