/**
 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially useful
 * for Docker builds.
 */
import "./src/env.js";
import { withSentryConfig } from "@sentry/nextjs";
import { withWorkflow } from "workflow/next";

/** @type {import("next").NextConfig} */
const config = {
  // The browser names Algolia indices by deployment (src/lib/constants.ts).
  env: { NEXT_PUBLIC_VERCEL_ENV: process.env.VERCEL_ENV ?? "" },
  // The required CI check runs the same type check (`bun run typecheck`
  // generates the route types first), so previews skip a second minute of
  // tsc. Production keeps it: main does not require branches to be up to
  // date, so two PRs that each pass CI can still merge into a type error.
  typescript: { ignoreBuildErrors: process.env.VERCEL_ENV !== "production" },
  async redirects() {
    // Old directory URL that still gets visits.
    return [{ source: "/yards", destination: "/junkyards", permanent: true }];
  },
  async headers() {
    return [
      {
        // Yard model pages render on each request (no ISR page), so Vercel's
        // CDN keeps the finished HTML instead: a repeat visit within an hour
        // runs no function, and for a day after that it gets the stale page
        // while one request refreshes it. Next still sends browsers
        // `private, no-store`. The page reads nothing from the request, and
        // its header renders the signed-in state in the browser.
        source: "/junkyards/:state/:yard/make/:make/model/:model",
        headers: [
          {
            key: "Vercel-CDN-Cache-Control",
            value: "s-maxage=3600, stale-while-revalidate=86400",
          },
        ],
      },
    ];
  },
  images: {
    loader: "custom",
    loaderFile: "./src/lib/wsrvLoader.ts",
    remotePatterns: [
      {
        protocol: "https",
        hostname: "cdn.lkqcorp.com",
      },
      {
        protocol: "https",
        hostname: "pypimages.azureedge.net",
      },
    ],
  },
};

const configWithSentry = withSentryConfig(config, {
  // For all available options, see:
  // https://www.npmjs.com/package/@sentry/webpack-plugin#options

  org: "whispchat",
  project: "junkyard-index",

  // Only print logs for uploading source maps in CI
  silent: !process.env.CI,

  // For all available options, see:
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/

  // Upload a larger set of source maps for prettier stack traces (increases build time)
  widenClientFileUpload: true,

  // Server Sentry is off in previews (sentry.server.config.ts), so preview
  // maps serve only the rare browser error, which then arrives minified.
  // Skipping the upload saves about 25 s of every preview build.
  sourcemaps: { disable: process.env.VERCEL_ENV === "preview" },

  // Route browser requests to Sentry through a Next.js rewrite to circumvent ad-blockers.
  // This can increase your server load as well as your hosting bill.
  // Note: Check that the configured route will not match with your Next.js middleware, otherwise reporting of client-
  // side errors will fail.
  tunnelRoute: "/monitoring",

  webpack: {
    // Enables automatic instrumentation of Vercel Cron Monitors. (Does not yet work with App Router route handlers.)
    // See the following for more information:
    // https://docs.sentry.io/product/crons/
    // https://vercel.com/docs/cron-jobs
    automaticVercelMonitors: true,

    // Tree-shaking options for reducing bundle size
    treeshake: {
      // Automatically tree-shake Sentry logger statements to reduce bundle size
      removeDebugLogging: true,
    },
  },
});

export default withWorkflow(configWithSentry);
