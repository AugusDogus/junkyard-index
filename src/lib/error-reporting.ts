import type * as SentrySdk from "@sentry/nextjs";
import { denyUrls, ignoreErrors } from "sentry-ignores";

/**
 * Browser error reporting that costs nothing until something breaks. The
 * Sentry SDK was the largest script on every page (about 2.8 s of mobile
 * main-thread time with tracing on), and loading it even after the page
 * was idle still cost each visit about 200 ms. So it loads on the first
 * uncaught error, rejection, or `capture` call; errors seen until it is
 * ready are reported once it is, and its own handlers take over from then
 * on. The cost: no breadcrumbs from before the first error. Browser only:
 * elsewhere `capture` does nothing, and the server reports through
 * `src/instrumentation.ts`.
 */
type Sentry = typeof SentrySdk;

let loading: Promise<Sentry> | null = null;
let listening = false;
const pending: unknown[] = [];

function onError(event: ErrorEvent): void {
  pending.push(event.error ?? event.message);
  void load();
}

function onRejection(event: PromiseRejectionEvent): void {
  pending.push(event.reason);
  void load();
}

function load(): Promise<Sentry> {
  loading ??= import("@sentry/nextjs").then((Sentry) => {
    Sentry.init({
      dsn: "https://33d625a367d4c7e056ec4b7541212efc@o4510218619322368.ingest.us.sentry.io/4510723310485504",
      // Ignore errors originating from third-party scripts we can't fix.
      denyUrls,
      ignoreErrors,
      // Errors only: browser tracing timed every page load and navigation.
      // https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/options/#sendDefaultPii
      sendDefaultPii: true,
    });
    // Sentry.init installed its own global handlers in this same task, so
    // nothing falls between ours and its.
    if (listening) {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
      listening = false;
    }
    for (const error of pending.splice(0)) Sentry.captureException(error);
    return Sentry;
  });
  return loading;
}

export const ErrorReporting = {
  /** Listens for uncaught errors, loading Sentry on the first one. */
  start(): void {
    if (listening || loading) return;
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    listening = true;
  },

  capture(error: unknown, extra?: Record<string, unknown>): void {
    if (typeof window === "undefined") return;
    void load().then((Sentry) => Sentry.captureException(error, { extra }));
  },
} as const;
