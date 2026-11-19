# Browser fixtures

Run `bun node_modules/playwright-core/cli.js install --with-deps --only-shell chromium`
once, then `bun test tests/browser`. These tests bundle their own fixture apps,
mock external services, and require no Next.js server, database, or secrets.
Saved-search fixtures define their own dummy public Algolia values.

CI runs two file shards alongside unit tests. Use `createPage` and `closePage`
from `browser-page.ts` for new tests so CI can collect diagnostics before pages
close. Set `BROWSER_TEST_ARTIFACTS=test-results/browser` locally to record them.
Each page produces a matching PNG screenshot and Playwright trace ZIP. The trace
includes source locations, actions, DOM snapshots, and screenshots. Since Bun
reports failures after test cleanup, diagnostics are recorded for all pages but
uploaded only when a shard fails, alongside its JUnit report.

Download the failed shard's `browser-shard-*` artifact and open a ZIP with
`bun node_modules/playwright-core/cli.js show-trace <trace.zip>`.
