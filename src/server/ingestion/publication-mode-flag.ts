import { flagsClient, Reason, type EvaluationResult } from "@vercel/flags-core";
import { Data } from "effect";

/**
 * Who publishes Turso inventory to search.
 *
 * - `inline`: each source run publishes its own changes before it releases
 *   the shared commit (or skips search, see `SearchPublicationFlag`).
 * - `decoupled`: a source run ends at its final reconciliation batch and
 *   never calls search. The singleton search projector reads
 *   `vehicle_change_v2` as an outbox and owns every search write.
 */
export type PublicationMode = "inline" | "decoupled";

/**
 * A reading of the flag. `unavailable`: the flag exists (or may) but could
 * not be evaluated, so the mode is unknown. A run that must decide waits a
 * minute and asks again, without counting a failure toward abandoning it
 * (see `PublicationModeFlag.decided`): guessing inline while
 * decoupled would start an inline search writer, and guessing decoupled or
 * skipped while inline would release a run mid-rebuild or owe a new one.
 */
export type PublicationModeReading = PublicationMode | "unavailable";

/** The publication mode could not be read, so the step deciding it stops. */
export class PublicationModeUnavailable extends Data.TaggedError(
  "PublicationModeUnavailable",
)<{ message: string }> {}

const MODES: readonly PublicationMode[] = ["inline", "decoupled"];

function isPublicationMode(value: unknown): value is PublicationMode {
  return MODES.some((mode) => mode === value);
}

/**
 * Whether this process can evaluate Vercel flags at all: on Vercel (OIDC) or
 * with an SDK key in FLAGS. Elsewhere (tests, local scripts) every
 * evaluation fails the same way and publication stays inline, as before the
 * flag existed.
 */
function flagsConfigured(): boolean {
  return process.env.VERCEL === "1" || Boolean(process.env.FLAGS);
}

// A temporary string Vercel flag for the relaunch cutover, removed once the
// inline path is deleted. A missing flag keeps inline publication, as before
// the flag existed, and so does a process that cannot read flags at all. A
// failed evaluation where flags are configured, or a value other than
// "inline" or "decoupled", is `unavailable`.
export const PublicationModeFlag = {
  key: "ingestion-publication-mode",

  resolve(
    result: EvaluationResult<unknown>,
    configured: boolean,
  ): PublicationModeReading {
    const key = PublicationModeFlag.key;
    if (result.reason === Reason.ERROR) {
      if (result.errorCode === "FLAG_NOT_FOUND" || !configured) return "inline";
      console.error(
        `Could not evaluate Vercel flag ${key}; the publication mode is unknown, so runs wait and retry without counting a failure, and the search projector waits: ${result.errorMessage}`,
      );
      return "unavailable";
    }
    if (!isPublicationMode(result.value)) {
      console.error(
        `Vercel flag ${key} served ${JSON.stringify(result.value)}, not "inline" or "decoupled"; the publication mode is unknown, so runs wait and retry without counting a failure, and the search projector waits. Make it a string flag with those two variants.`,
      );
      return "unavailable";
    }
    return result.value;
  },

  /** The current mode. Read it where work decides, inside a step. */
  async mode(): Promise<PublicationModeReading> {
    const configured = flagsConfigured();
    let result: EvaluationResult<unknown>;
    try {
      result = await flagsClient.evaluate<unknown>(
        PublicationModeFlag.key,
        "inline",
      );
    } catch (error) {
      if (!configured) return "inline";
      console.error(
        `Could not evaluate Vercel flag ${PublicationModeFlag.key}; the publication mode is unknown, so runs wait and retry without counting a failure, and the search projector waits`,
        error,
      );
      return "unavailable";
    }
    return PublicationModeFlag.resolve(result, configured);
  },

  /**
   * The mode a step acts on. An unreadable mode throws, so the step is
   * retried instead of releasing, skipping or writing search on a guess.
   * Nothing has been written when it throws.
   */
  decided(reading: PublicationModeReading): PublicationMode {
    if (reading !== "unavailable") return reading;
    throw new PublicationModeUnavailable({
      message: `Vercel flag ${PublicationModeFlag.key} could not be read, so this step cannot tell inline from decoupled publication. Nothing was written; the step is retried. If it keeps failing, check Vercel Flags and the deployment's flags configuration.`,
    });
  },
} as const;
