import { flagsClient, Reason, type EvaluationResult } from "@vercel/flags-core";

/**
 * Whether saved-search alerts run: the daily check that matches saved
 * searches against Algolia, and delivery of the notifications it creates.
 */
export type SearchAlertsMode = "enabled" | "disabled";

// Vercel Flags pause saved-search alerts without a deploy, for example while
// a relaunch skips a backlog. Serve true for the boolean
// `search-alerts-enabled` flag to run them. Alerts fail closed: a missing
// flag, a failed evaluation or a non-boolean value pauses them, and so does
// a new flag, which serves false in production until it is turned on. While
// paused nothing creates a check, searches Algolia, advances a saved search's
// window or sends a notification; pending notifications wait.
export const SearchAlertsFlag = {
  key: "search-alerts-enabled",

  resolve(result: EvaluationResult<unknown>): SearchAlertsMode {
    const key = SearchAlertsFlag.key;
    if (result.reason === Reason.ERROR) {
      if (result.errorCode !== "FLAG_NOT_FOUND") {
        console.error(
          `Could not evaluate Vercel flag ${key}; saved-search alerts stay paused: ${result.errorMessage}`,
        );
      }
      return "disabled";
    }
    if (typeof result.value !== "boolean") {
      console.error(
        `Vercel flag ${key} served ${JSON.stringify(result.value)}, not a boolean; saved-search alerts stay paused. Make it a boolean flag.`,
      );
      return "disabled";
    }
    return result.value ? "enabled" : "disabled";
  },

  /** The current mode. Read it where alert work starts, inside a step. */
  async mode(): Promise<SearchAlertsMode> {
    let result: EvaluationResult<unknown>;
    try {
      result = await flagsClient.evaluate<unknown>(SearchAlertsFlag.key, false);
    } catch (error) {
      console.error(
        `Could not evaluate Vercel flag ${SearchAlertsFlag.key}; saved-search alerts stay paused`,
        error,
      );
      return "disabled";
    }
    return SearchAlertsFlag.resolve(result);
  },
} as const;
