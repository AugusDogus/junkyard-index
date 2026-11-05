// This file configures the initialization of Sentry on the client.
// The added config here will be used whenever a users loads a page in their browser.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";
import { captureRouterTransitionStart } from "@sentry/nextjs";
import posthog from "posthog-js";
import { denyUrls, ignoreErrors } from "sentry-ignores";
import { env } from "~/env";

Sentry.init({
  dsn: "https://33d625a367d4c7e056ec4b7541212efc@o4510218619322368.ingest.us.sentry.io/4510723310485504",

  // Ignore errors originating from third-party scripts we can't fix.
  denyUrls,
  ignoreErrors,

  // Define how likely traces are sampled. Adjust this value in production, or use tracesSampler for greater control.
  tracesSampleRate: 1,
  // Enable logs to be sent to Sentry
  enableLogs: true,

  // Enable sending user PII (Personally Identifiable Information)
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/options/#sendDefaultPii
  sendDefaultPii: true,
});

// No session replay in either tool: nobody watches the recordings, and
// recording the DOM cost every page about 650 ms of main-thread time on
// mobile. Surveys and dead-click capture are off too, so their scripts never
// load. Events, pageviews, and web vitals still report.
posthog.init(env.NEXT_PUBLIC_POSTHOG_KEY, {
  api_host: env.NEXT_PUBLIC_POSTHOG_HOST,
  defaults: "2026-01-30",
  disable_session_recording: true,
  disable_surveys: true,
  capture_dead_clicks: false,
});

export const onRouterTransitionStart = captureRouterTransitionStart;
