import { sleep } from "workflow";

/** Retry interval while `ingestion-publication-mode` cannot be read. */
export const PUBLICATION_MODE_RETRY_DELAY = "1m";

/**
 * Waits before a source run asks for the publication mode again. A durable
 * workflow sleep: the run keeps the commit, writes nothing, and the wait
 * never counts as a failure toward abandoning it.
 */
export function waitForPublicationMode(): Promise<void> {
  return sleep(PUBLICATION_MODE_RETRY_DELAY);
}
