// Runs in the browser before the app hydrates. Analytics and error reporting
// load once the page is idle, so neither delays the first render; see
// `src/lib/analytics.ts` and `src/lib/error-reporting.ts`.
import { Analytics } from "~/lib/analytics";
import { AnalyticsEvents } from "~/lib/analytics-events";
import { ErrorReporting } from "~/lib/error-reporting";
import { SearchQueryMeter, searchQueryMeter } from "~/lib/search-query-meter";

ErrorReporting.start();
Analytics.start();

// One event per page view with the Algolia requests and queries the browser
// sent, so quota spend is attributable (docs/runbooks/search-quota.md).
const reportSearchQueries = SearchQueryMeter.reportPageViews({
  meter: searchQueryMeter,
  capture: (usage) =>
    Analytics.capture(AnalyticsEvents.SEARCH_QUERIES_METERED, usage),
  window,
  document,
});

/** Client navigations end the previous page view. */
export function onRouterTransitionStart() {
  reportSearchQueries();
}
