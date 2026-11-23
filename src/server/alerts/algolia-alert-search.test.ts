import { expect, test } from "bun:test";

// A fresh process isolates the module mocks from the rest of the suite.
test("saved-search alert scans exclude every hidden source", () => {
  const script = String.raw`
globalThis.fetch = async () => {
  throw new Error("Live network is forbidden in alert search tests");
};
import { expect, mock } from "bun:test";
import { HiddenSources } from "./src/lib/hidden-source";
import type { AlertSearchClient } from "./src/lib/alert-match-search";

const filters: (string | undefined)[] = [];
const searchForHits: AlertSearchClient["searchForHits"] = async ({ requests }) => {
  filters.push(...requests.map((request) => request.filters));
  return {
    results: requests.map((request) => ({
      hits: [],
      nbHits: 0,
      nbPages: 0,
      page: request.page,
      hitsPerPage: request.hitsPerPage,
      processingTimeMS: 0,
      query: request.query,
      params: "",
    })),
  };
};
mock.module("server-only", () => ({}));
mock.module("./src/server/algolia-search-client", () => ({
  algoliaSearchClient: { searchForHits },
}));
mock.module("./src/server/ingestion/search-index-readiness", () => ({
  getSearchIndexCapabilities: async () => ({ makeAliasesReady: true }),
}));
const hidden = HiddenSources.of(["meeks", "pratt"]);
mock.module("./src/lib/db", () => ({ db: {} }));
mock.module("./src/server/source-control/source-control-repository", () => ({
  SourceControlRepository: { hiddenSources: async () => hidden },
}));
const { getAlertMatchStatsBatch } = await import(
  "./src/server/alerts/algolia-alert-search"
);

const results = await getAlertMatchStatsBatch(
  [
    { query: "", filters: {}, lastCheckedAt: null },
    { query: "civic", filters: { minYear: 2010 }, lastCheckedAt: null },
  ],
  { checkedThrough: new Date(), latestFirstSeenAt: new Date() },
);
expect(results.map((result) => result.status)).toEqual([
  "fulfilled",
  "fulfilled",
]);
expect(filters).toHaveLength(2);
for (const filter of filters) {
  expect(filter?.endsWith(String(HiddenSources.algoliaFilter(hidden)))).toBe(true);
  for (const source of hidden.list)
    expect(filter).toContain('NOT source:"' + source + '"');
}
`;
  const result = Bun.spawnSync([process.execPath, "--eval", script], {
    cwd: process.cwd(),
  });
  expect(result.stderr.toString()).toBe("");
  expect(result.exitCode).toBe(0);
});
