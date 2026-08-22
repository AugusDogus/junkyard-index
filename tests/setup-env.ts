// Bun test preload (see bunfig.toml [test].preload). Seeds safe placeholder
// env vars BEFORE any module loads so tests can import modules that validate
// ~/env or construct clients at import time. Real env vars always win because
// we only set what's missing. No test should depend on these values.
const defaults: Record<string, string> = {
  TURSO_DATABASE_URL: "http://127.0.0.1:8080",
  TURSO_AUTH_TOKEN: "test-turso-token",
  BETTER_AUTH_SECRET: "test-better-auth-secret-0123456789abcdef",
  POLAR_ACCESS_TOKEN: "test-polar-access-token",
  // Legacy product ID; grandfathered as Full by src/server/billing/user-plan.ts
  POLAR_PRODUCT_ID: "00000000-0000-4000-8000-000000000001",
  POLAR_LITE_PRODUCT_ID: "00000000-0000-4000-8000-000000000002",
  POLAR_LITE_ANNUAL_PRODUCT_ID: "00000000-0000-4000-8000-000000000003",
  POLAR_FULL_PRODUCT_ID: "00000000-0000-4000-8000-000000000004",
  POLAR_FULL_ANNUAL_PRODUCT_ID: "00000000-0000-4000-8000-000000000005",
  POLAR_WEBHOOK_SECRET: "test-polar-webhook-secret",
  DISCORD_CLIENT_SECRET: "test-discord-client-secret",
  DISCORD_BOT_TOKEN: "test-discord-bot-token",
  RESEND_API_KEY: "test-resend-api-key",
  RESEND_FROM_EMAIL: "test@junkyardindex.test",
  CONTACT_EMAIL: "contact@junkyardindex.test",
  UNSUBSCRIBE_SECRET: "test-unsubscribe-secret-0123456789abcdef",
  ALGOLIA_WRITE_API_KEY: "test-algolia-write-key",
  HYPERBROWSER_API_KEY: "test-hyperbrowser-api-key",
  NEXT_PUBLIC_APP_URL: "http://localhost:3000",
  NEXT_PUBLIC_DISCORD_CLIENT_ID: "test-discord-client-id",
  NEXT_PUBLIC_POSTHOG_KEY: "test-posthog-key",
  NEXT_PUBLIC_POSTHOG_HOST: "https://posthog.example.com",
  NEXT_PUBLIC_ALGOLIA_APP_ID: "test-algolia-app-id",
  NEXT_PUBLIC_ALGOLIA_SEARCH_API_KEY: "test-algolia-search-key",
};

for (const [key, value] of Object.entries(defaults)) {
  if (!process.env[key]) {
    process.env[key] = value;
  }
}
