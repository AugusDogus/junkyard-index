// Runs in the browser before the app hydrates. Analytics and error reporting
// load once the page is idle, so neither delays the first render; see
// `src/lib/analytics.ts` and `src/lib/error-reporting.ts`.
import { Analytics } from "~/lib/analytics";
import { ErrorReporting } from "~/lib/error-reporting";

ErrorReporting.start();
Analytics.start();
