import { createHash } from "node:crypto";
import type { Acl } from "algoliasearch";
import { z } from "zod";
import { AlgoliaDeployment } from "~/lib/algolia-deployment";
import { ALGOLIA_SEARCH_INDEX_NAMES } from "~/lib/constants";

/**
 * The search keys the app holds, by what they are for:
 * - `browser-parent` (ALGOLIA_SEARCH_PARENT_API_KEY) never leaves the server.
 *   Browsers get secured keys minted from it (`SearchApiKey.mint`), which
 *   inherit its limits; the secured key's `userToken` makes Algolia count
 *   `maxQueriesPerIPPerHour` per visitor or account, not per shared IP.
 * - `server` (ALGOLIA_SEARCH_API_KEY) is for server renders and alert
 *   matching. Vercel functions share AWS egress IPs, so it has no per-IP
 *   limit, and it must never reach a browser.
 */
export type AlgoliaApiKeyRole = "browser-parent" | "server";

/** A key's settings, as `PUT /1/keys/{key}` writes them. */
export type AlgoliaApiKeySettings = {
  acl: Acl[];
  description: string;
  indexes: string[];
  maxHitsPerQuery: number;
  maxQueriesPerIPPerHour: number;
  queryParameters: string;
  referers: string[];
  validity: number;
};

/** A key as `GET /1/keys/{key}` answers, with unset limits as 0 or empty. */
export type AlgoliaApiKey = AlgoliaApiKeySettings & {
  value: string;
  createdAt: number;
};

/**
 * Limits from the site's own browser calls in the query logs for Nov 21-27,
 * 2026 (947 calls): the busiest visitor made 104 calls, holding 171
 * queries, in one hour (p99 92 calls), and every results page asks for 24
 * hits (`hitsPerPage: 0` for counts). Direct API callers asked for 500 or
 * 1,000 hits per query.
 */
const BROWSER_MAX_QUERIES_PER_HOUR = 400;
const BROWSER_MAX_HITS_PER_QUERY = 100;

// Previews and development deployments search the same app under their own
// prefix, so one key per role serves every deployment.
const SEARCH_INDEXES = (["production", "preview", "development"] as const)
  .flatMap((deployment) =>
    ALGOLIA_SEARCH_INDEX_NAMES.map((name) =>
      AlgoliaDeployment.indexName(deployment, name),
    ),
  )
  .filter((name, index, all) => all.indexOf(name) === index);

const roles = [
  "browser-parent",
  "server",
] as const satisfies readonly AlgoliaApiKeyRole[];

function forRole(role: AlgoliaApiKeyRole): AlgoliaApiKeySettings {
  const shared = {
    acl: ["search"] satisfies Acl[],
    indexes: [...SEARCH_INDEXES],
    queryParameters: "",
    referers: [],
    validity: 0,
  };
  switch (role) {
    case "browser-parent":
      return {
        ...shared,
        description:
          "Junkyard Index browser parent (ALGOLIA_SEARCH_PARENT_API_KEY): server-only, signs browsers' secured keys",
        maxHitsPerQuery: BROWSER_MAX_HITS_PER_QUERY,
        maxQueriesPerIPPerHour: BROWSER_MAX_QUERIES_PER_HOUR,
      };
    case "server":
      return {
        ...shared,
        description:
          "Junkyard Index server search (ALGOLIA_SEARCH_API_KEY): server renders and alerts, never sent to browsers",
        maxHitsPerQuery: 0,
        maxQueriesPerIPPerHour: 0,
      };
  }
}

const ACLS = [
  "addObject",
  "analytics",
  "browse",
  "deleteObject",
  "deleteIndex",
  "editSettings",
  "inference",
  "listIndexes",
  "logs",
  "personalization",
  "recommendation",
  "search",
  "seeUnretrievableAttributes",
  "settings",
  "usage",
  "nluWriteProject",
  "nluReadProject",
  "nluWriteEntity",
  "nluReadEntity",
  "nluWriteIntent",
  "nluReadIntent",
  "nluPrediction",
  "nluReadAnswers",
] as const satisfies readonly Acl[];

const schema = z.object({
  value: z.string().min(1),
  createdAt: z.number(),
  acl: z.array(z.enum(ACLS)),
  description: z.string().default(""),
  indexes: z.array(z.string()).default([]),
  maxHitsPerQuery: z.number().int().nonnegative().default(0),
  maxQueriesPerIPPerHour: z.number().int().nonnegative().default(0),
  queryParameters: z.string().default(""),
  referers: z.array(z.string()).default([]),
  validity: z.number().int().nonnegative().default(0),
});

/** Parses a key from Algolia's answer or a saved backup file. */
function parse(value: unknown): AlgoliaApiKey {
  return schema.parse(value);
}

/** Names a key in output and logs without revealing it. */
function fingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 10);
}

/** A key's settings for printing: everything but its value. */
function summary(key: AlgoliaApiKey) {
  return { fingerprint: fingerprint(key.value), ...settingsOf(key) };
}

/** The settings to write back to restore a key exactly. */
function settingsOf(key: AlgoliaApiKey): AlgoliaApiKeySettings {
  return {
    acl: key.acl,
    description: key.description,
    indexes: key.indexes,
    maxHitsPerQuery: key.maxHitsPerQuery,
    maxQueriesPerIPPerHour: key.maxQueriesPerIPPerHour,
    queryParameters: key.queryParameters,
    referers: key.referers,
    validity: key.validity,
  };
}

/**
 * Settings that stop a leaked key from reading any index this app searches,
 * while keeping it in place so `settingsOf(before)` restores it in one call.
 */
function retired(before: AlgoliaApiKey, now: Date): AlgoliaApiKeySettings {
  const day = now.toISOString().slice(0, 10);
  return {
    ...settingsOf(before),
    acl: ["search"],
    indexes: [`retired-key-${day.replaceAll("-", "")}`],
    description: `${before.description} [retired ${day}: leaked public search key, restore from the backup file]`,
  };
}

export type RetireDecision =
  | { kind: "allowed" }
  | { kind: "refused"; reason: string };

const SEARCH_ONLY_ACLS = new Set<Acl>(["search", "listIndexes", "settings"]);

/**
 * Whether a key may be retired now. `browserKey` is the key production's
 * `/api/search-key` hands a visitor: while it is a plain key, browsers still
 * search with an unsecured key, so the new keys are not live yet.
 */
function retireDecision(
  target: AlgoliaApiKey,
  browserKey: string,
): RetireDecision {
  if (target.acl.some((acl) => !SEARCH_ONLY_ACLS.has(acl))) {
    return {
      kind: "refused",
      reason: `key ${fingerprint(target.value)} has ACL ${target.acl.join(",")}, not a search-only key. Only the leaked search key is retired this way.`,
    };
  }
  if (!isSecured(browserKey)) {
    return {
      kind: "refused",
      reason: `production /api/search-key still returns the plain key ${fingerprint(browserKey)}, not a secured key. Set ALGOLIA_SEARCH_PARENT_API_KEY and ALGOLIA_SEARCH_API_KEY to the new keys and redeploy production first.`,
    };
  }
  return { kind: "allowed" };
}

/** A secured key is base64 of a 64-hex HMAC followed by its restrictions. */
function isSecured(apiKey: string): boolean {
  return /^[0-9a-f]{64}./.test(Buffer.from(apiKey, "base64").toString("utf8"));
}

export const AlgoliaApiKeySpec = {
  roles,
  forRole,
  parse,
  fingerprint,
  summary,
  settingsOf,
  retired,
  retireDecision,
  isSecured,
} as const;
