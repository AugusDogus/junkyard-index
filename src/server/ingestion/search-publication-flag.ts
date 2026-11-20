import { flagsClient, Reason, type EvaluationResult } from "@vercel/flags-core";

/**
 * How a source run treats search once its inventory is in Turso.
 *
 * - `inline`: the run projects its changes to Algolia (or rebuilds the index)
 *   and matches alerts before it releases the shared commit.
 * - `skipped`: the final reconciliation batch releases the run. It makes no
 *   Algolia request, leaves its `vehicle_change_v2` rows unprocessed, and
 *   sets `full_reindex_required`, so the first inline run after the switch
 *   turns off inherits a full rebuild that covers every skipped change.
 */
export type SearchPublicationMode = "inline" | "skipped";

// Vercel Flags freeze search without a deploy while Turso ingestion keeps
// running, for example while Algolia rejects writes. Serve true for the
// boolean `ingestion-skip-search-publication` flag to skip search publication.
// A missing flag, a failed evaluation or a non-boolean value keeps search
// inline. New Vercel flags serve false in production, so creating the flag
// changes nothing until it is turned on.
export const SearchPublicationFlag = {
  key: "ingestion-skip-search-publication",

  resolve(result: EvaluationResult<unknown>): SearchPublicationMode {
    const key = SearchPublicationFlag.key;
    if (result.reason === Reason.ERROR) {
      if (result.errorCode !== "FLAG_NOT_FOUND") {
        console.error(
          `Could not evaluate Vercel flag ${key}; publishing search inline: ${result.errorMessage}`,
        );
      }
      return "inline";
    }
    if (typeof result.value !== "boolean") {
      console.error(
        `Vercel flag ${key} served ${JSON.stringify(result.value)}, not a boolean; publishing search inline. Make it a boolean flag.`,
      );
      return "inline";
    }
    return result.value ? "skipped" : "inline";
  },

  /** The current mode. Read it where the run decides, inside a step. */
  async mode(): Promise<SearchPublicationMode> {
    let result: EvaluationResult<unknown>;
    try {
      result = await flagsClient.evaluate<unknown>(
        SearchPublicationFlag.key,
        false,
      );
    } catch (error) {
      // The run is reconciling and holds the shared commit. Failing it here
      // would count toward abandoning a half-reconciled run, so keep the
      // default, as a failed evaluation result does.
      console.error(
        `Could not evaluate Vercel flag ${SearchPublicationFlag.key}; publishing search inline`,
        error,
      );
      return "inline";
    }
    return SearchPublicationFlag.resolve(result);
  },
} as const;
