import posthog from "posthog-js";
import { AnalyticsEvents } from "~/lib/analytics-events";

/**
 * Single place that knows the REQUEST_YARD_CLICKED event contract, so the
 * three CTA sites (footer, lot filter, search empty state) can't drift.
 */
export type RequestYardClickInput =
  | { location: "no_results"; query: string }
  | { location: "footer"; sourcePage: string }
  | { location: "lot_filter" };

export function trackRequestYardClick(input: RequestYardClickInput): void {
  posthog.capture(AnalyticsEvents.REQUEST_YARD_CLICKED, {
    cta_location: input.location,
    // no_results and lot_filter only ever fire on /search
    source_page: input.location === "footer" ? input.sourcePage : "search",
    ...(input.location === "no_results"
      ? { query: input.query, result_count: 0, visible_result_count: 0 }
      : {}),
  });
}
