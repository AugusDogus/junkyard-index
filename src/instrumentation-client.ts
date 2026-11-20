// Runs in the browser before the app hydrates. Analytics and error reporting
// load once the page is idle, so neither delays the first render; see
// `src/lib/analytics.ts` and `src/lib/error-reporting.ts`.
import { Analytics } from "~/lib/analytics";
import { AnalyticsEvents } from "~/lib/analytics-events";
import { ErrorReporting } from "~/lib/error-reporting";
import { searchQueryMeter } from "~/lib/search-query-meter";

ErrorReporting.start();
Analytics.start();

// One event per page view (and per return to a hidden tab) with the Algolia
// requests and queries the browser sent, so quota spend is attributable.
function reportSearchQueries() {
  const usage = searchQueryMeter.take();
  if (usage) Analytics.capture(AnalyticsEvents.SEARCH_QUERIES_METERED, usage);
}
window.addEventListener("pagehide", reportSearchQueries);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") reportSearchQueries();
});

/** Client navigations end the previous page view. */
export function onRouterTransitionStart() {
  reportSearchQueries();
}
