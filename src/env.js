import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

const cronSecretSchema =
  process.env.NODE_ENV === "production"
    ? z.string().min(16)
    : z.string().min(16).optional();

const betterStackApiTokenSchema =
  process.env.VERCEL_ENV === "production"
    ? z.string().min(1)
    : z.string().min(1).optional();

export const env = createEnv({
  /**
   * Specify your server-side environment variables schema here. This way you can ensure the app
   * isn't built with invalid env vars.
   */
  server: {
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    TURSO_DATABASE_URL: z.string().url(),
    TURSO_AUTH_TOKEN: z.string(),
    BETTER_AUTH_SECRET: z.string().min(32),
    OAUTH_PROXY_SECRET: z.string().min(32),
    POLAR_ACCESS_TOKEN: z.string(),
    // Legacy single-product ID ("Email-Notifications"). Existing subscribers
    // are grandfathered as the Full tier so they keep the alerts they pay for.
    // Safe to remove once all legacy subscriptions have migrated.
    POLAR_PRODUCT_ID: z.string().uuid().optional(),
    // Monthly and annual SKUs for each paid tier. Annual lives on a separate
    // product because the Better Auth Polar plugin selects products by slug
    // only and cannot pass an interval.
    POLAR_LITE_PRODUCT_ID: z.string().uuid(),
    POLAR_LITE_ANNUAL_PRODUCT_ID: z.string().uuid(),
    POLAR_FULL_PRODUCT_ID: z.string().uuid(),
    POLAR_FULL_ANNUAL_PRODUCT_ID: z.string().uuid(),
    POLAR_WEBHOOK_SECRET: z.string(),
    DISCORD_CLIENT_SECRET: z.string(),
    DISCORD_BOT_TOKEN: z.string(),
    RESEND_API_KEY: z.string(),
    RESEND_FROM_EMAIL: z.string().email(),
    CONTACT_EMAIL: z.string().email(),
    CRON_SECRET: cronSecretSchema,
    UNSUBSCRIBE_SECRET: z.string().min(32),
    // Google Ads conversion tracking (optional)
    GOOGLE_ADS_CONVERSION_ID: z.string().optional(),
    GOOGLE_ADS_CONVERSION_LABEL: z.string().optional(),
    // Algolia (server-only write key for ingestion)
    ALGOLIA_WRITE_API_KEY: z.string(),
    // Search-only key for server renders and alert matching. Never sent to
    // browsers; they get secured keys from /api/search-key.
    ALGOLIA_SEARCH_API_KEY: z.string(),
    // Search-only parent of browsers' secured keys. Set maxQueriesPerIPPerHour
    // on it in the Algolia dashboard. Until it is set, browsers receive
    // ALGOLIA_SEARCH_API_KEY unrestricted.
    ALGOLIA_SEARCH_PARENT_API_KEY: z.string().optional(),
    // The Algolia plan's record cap (free plan: 1,000,000). A full search
    // rebuild copies the live index only when the copy fits under it.
    ALGOLIA_RECORD_LIMIT: z.coerce.number().int().positive().default(1_000_000),
    BETTERSTACK_HEARTBEAT_URL: z.string().url().optional(),
    BETTERSTACK_API_TOKEN: betterStackApiTokenSchema,
    // JSON object of ingestion source to its Better Stack status page row:
    // { "pyp": { "resourceId": 123, "heartbeatUrl": "https://..." }, ... }
    BETTERSTACK_PROVIDERS: z.string().optional(),
    // JSON object of downstream consumer to its Better Stack heartbeat URL:
    // { "inventory-downstream": "https://...", "maintenance": "https://..." }
    BETTERSTACK_CONSUMER_HEARTBEATS: z.string().optional(),
    // Hyperbrowser (remote browser for protected provider ingestion)
    HYPERBROWSER_API_KEY: z.string(),
    // Kernel (remote browser for sources that browser-providers.ts assigns to
    // it). Optional: a source assigned to Kernel fails its browser opens with a
    // clear error while it is unset.
    KERNEL_API_KEY: z.string().optional(),
    // The Kernel plan's concurrent browser limit (5 on Developer); unset means
    // 5. Read by src/server/ingestion/kernel-sessions.ts, validated here too
    // so a bad value fails the build.
    KERNEL_CONCURRENT_SESSIONS: z
      .string()
      .regex(/^[1-9][0-9]{0,2}$/)
      .optional(),
    // Vercel Blob (private store for staged ingestion snapshot chunks)
    BLOB_READ_WRITE_TOKEN: z.string(),
    PORTLESS_URL: z.string().url().optional(),
    VERCEL_PROJECT_PRODUCTION_URL: z.string().optional(),
    // Upstash Redis (rate limiting)
    UPSTASH_REDIS_REST_URL: z.string().url(),
    UPSTASH_REDIS_REST_TOKEN: z.string(),
    // Comma-separated Better Auth user ids allowed into /admin. Unset or
    // empty: no one is, and every admin page answers 404.
    ADMIN_USER_IDS: z.string().optional(),
  },

  /**
   * Specify your client-side environment variables schema here. This way you can ensure the app
   * isn't built with invalid env vars. To expose them to the client, prefix them with
   * `NEXT_PUBLIC_`.
   */
  client: {
    NEXT_PUBLIC_APP_URL: z.string().url(),
    NEXT_PUBLIC_DISCORD_CLIENT_ID: z.string(),
    NEXT_PUBLIC_POSTHOG_KEY: z.string(),
    NEXT_PUBLIC_POSTHOG_HOST: z.string().url(),
    // Algolia (public, safe to expose)
    NEXT_PUBLIC_ALGOLIA_APP_ID: z.string(),
    NEXT_PUBLIC_STATUS_PAGE_URL: z.string().url().optional(),
  },

  /**
   * You can't destruct `process.env` as a regular object in the Next.js edge runtimes (e.g.
   * middlewares) or client-side so we need to destruct manually.
   */
  runtimeEnv: {
    NODE_ENV: process.env.NODE_ENV,
    TURSO_DATABASE_URL: process.env.TURSO_DATABASE_URL,
    TURSO_AUTH_TOKEN: process.env.TURSO_AUTH_TOKEN,
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
    OAUTH_PROXY_SECRET: process.env.OAUTH_PROXY_SECRET,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_DISCORD_CLIENT_ID: process.env.NEXT_PUBLIC_DISCORD_CLIENT_ID,
    POLAR_ACCESS_TOKEN: process.env.POLAR_ACCESS_TOKEN,
    POLAR_PRODUCT_ID: process.env.POLAR_PRODUCT_ID,
    POLAR_LITE_PRODUCT_ID: process.env.POLAR_LITE_PRODUCT_ID,
    POLAR_LITE_ANNUAL_PRODUCT_ID: process.env.POLAR_LITE_ANNUAL_PRODUCT_ID,
    POLAR_FULL_PRODUCT_ID: process.env.POLAR_FULL_PRODUCT_ID,
    POLAR_FULL_ANNUAL_PRODUCT_ID: process.env.POLAR_FULL_ANNUAL_PRODUCT_ID,
    POLAR_WEBHOOK_SECRET: process.env.POLAR_WEBHOOK_SECRET,
    DISCORD_CLIENT_SECRET: process.env.DISCORD_CLIENT_SECRET,
    DISCORD_BOT_TOKEN: process.env.DISCORD_BOT_TOKEN,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    RESEND_FROM_EMAIL: process.env.RESEND_FROM_EMAIL,
    CONTACT_EMAIL: process.env.CONTACT_EMAIL,
    CRON_SECRET: process.env.CRON_SECRET,
    UNSUBSCRIBE_SECRET: process.env.UNSUBSCRIBE_SECRET,
    GOOGLE_ADS_CONVERSION_ID: process.env.GOOGLE_ADS_CONVERSION_ID,
    GOOGLE_ADS_CONVERSION_LABEL: process.env.GOOGLE_ADS_CONVERSION_LABEL,
    NEXT_PUBLIC_POSTHOG_KEY: process.env.NEXT_PUBLIC_POSTHOG_KEY,
    NEXT_PUBLIC_POSTHOG_HOST: process.env.NEXT_PUBLIC_POSTHOG_HOST,
    ALGOLIA_WRITE_API_KEY: process.env.ALGOLIA_WRITE_API_KEY,
    BETTERSTACK_HEARTBEAT_URL: process.env.BETTERSTACK_HEARTBEAT_URL,
    BETTERSTACK_API_TOKEN: process.env.BETTERSTACK_API_TOKEN,
    BETTERSTACK_PROVIDERS: process.env.BETTERSTACK_PROVIDERS,
    BETTERSTACK_CONSUMER_HEARTBEATS:
      process.env.BETTERSTACK_CONSUMER_HEARTBEATS,
    HYPERBROWSER_API_KEY: process.env.HYPERBROWSER_API_KEY,
    KERNEL_API_KEY: process.env.KERNEL_API_KEY,
    KERNEL_CONCURRENT_SESSIONS: process.env.KERNEL_CONCURRENT_SESSIONS,
    BLOB_READ_WRITE_TOKEN: process.env.BLOB_READ_WRITE_TOKEN,
    PORTLESS_URL: process.env.PORTLESS_URL,
    VERCEL_PROJECT_PRODUCTION_URL: process.env.VERCEL_PROJECT_PRODUCTION_URL,
    UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL,
    UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN,
    ADMIN_USER_IDS: process.env.ADMIN_USER_IDS,
    NEXT_PUBLIC_ALGOLIA_APP_ID: process.env.NEXT_PUBLIC_ALGOLIA_APP_ID,
    ALGOLIA_SEARCH_API_KEY: process.env.ALGOLIA_SEARCH_API_KEY,
    ALGOLIA_SEARCH_PARENT_API_KEY: process.env.ALGOLIA_SEARCH_PARENT_API_KEY,
    ALGOLIA_RECORD_LIMIT: process.env.ALGOLIA_RECORD_LIMIT,
    NEXT_PUBLIC_STATUS_PAGE_URL: process.env.NEXT_PUBLIC_STATUS_PAGE_URL,
  },
  /**
   * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially
   * useful for Docker builds.
   */
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  /**
   * Makes it so that empty strings are treated as undefined. `SOME_VAR: z.string()` and
   * `SOME_VAR=''` will throw an error.
   */
  emptyStringAsUndefined: true,
});
