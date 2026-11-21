import { flagsClient, Reason, type EvaluationResult } from "@vercel/flags-core";
import {
  PublicationModeFlag,
  type PublicationModeReading,
} from "./publication-mode-flag";

/**
 * How a source run treats search once its inventory is in Turso.
 *
 * - `inline`: the run projects its changes to Algolia (or rebuilds the index)
 *   and matches alerts before it releases the shared commit.
 * - `skipped`: the final reconciliation batch releases the run. It makes no
 *   Algolia request, leaves its `vehicle_change_v2` rows unprocessed, and
 *   sets `full_reindex_required`, so the first inline run after the switch
 *   turns off inherits a full rebuild that covers every skipped change.
 * - `decoupled`: the final reconciliation batch releases the run, as when
 *   skipped, but owes search nothing: the search projector reads its
 *   `vehicle_change_v2` rows as an outbox, so it sets no
 *   `full_reindex_required` (and clears an inherited one).
 */
export type SearchPublicationMode = "inline" | "skipped" | "decoupled";

// Vercel Flags freeze search without a deploy while Turso ingestion keeps
// running, for example while Algolia rejects writes. Serve true for the
// boolean `ingestion-skip-search-publication` flag to skip search publication.
// A missing flag, a failed evaluation or a non-boolean value keeps search
// inline. New Vercel flags serve false in production, so creating the flag
// changes nothing until it is turned on.
export const SearchPublicationFlag = {
  key: "ingestion-skip-search-publication",

  resolve(result: EvaluationResult<unknown>): "inline" | "skipped" {
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

  /** The skip flag alone. Read it where the run decides, inside a step. */
  async mode(): Promise<"inline" | "skipped"> {
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

  /**
   * How a run publishes search now: decoupled when `ingestion-publication-mode`
   * says so, whatever the skip flag serves; otherwise the skip flag decides.
   * When the publication mode cannot be read, this throws
   * `PublicationModeUnavailable`. The reconcile entry point
   * (`reconcileDurableIngestion`) catches it and returns `mode_unavailable`
   * before writing anything; the workflow waits a minute and asks again,
   * without counting a failure toward abandoning the run.
   */
  async publication(): Promise<SearchPublicationMode> {
    return SearchPublicationFlag.publicationFor(
      await PublicationModeFlag.mode(),
      () => SearchPublicationFlag.mode(),
    );
  },

  /**
   * `publication` for a mode reading; reads the skip flag only when inline,
   * and throws `PublicationModeUnavailable` for an unreadable mode.
   */
  async publicationFor(
    mode: PublicationModeReading,
    skipFlag: () => Promise<"inline" | "skipped">,
  ): Promise<SearchPublicationMode> {
    switch (PublicationModeFlag.decided(mode)) {
      case "decoupled":
        return "decoupled";
      case "inline":
        return skipFlag();
    }
  },
} as const;
