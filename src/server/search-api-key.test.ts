import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { algoliasearch } from "algoliasearch";
import { SearchApiKey } from "./search-api-key";

const NOW = Date.UTC(2026, 10, 20, 12);
const PARENT = "parent-search-key";

/** Splits a secured key into its signature and the restrictions it signs. */
function decode(apiKey: string) {
  const decoded = Buffer.from(apiKey, "base64").toString("utf8");
  const signature = decoded.slice(0, 64);
  const query = decoded.slice(64);
  return { signature, query, params: new URLSearchParams(query) };
}

function mint(tier: "free" | "lite" | "full") {
  return SearchApiKey.mint({
    parentApiKey: PARENT,
    tier,
    visitor: "203.0.113.7",
    nowMs: NOW,
  });
}

describe("SearchApiKey.mint", () => {
  test("signs its restrictions with the parent key, without a network call", () => {
    const { signature, query } = decode(mint("free").apiKey);
    expect(signature).toBe(
      createHmac("sha256", PARENT).update(query).digest("hex"),
    );
  });

  test("matches the key Algolia's own helper mints from the same restrictions", () => {
    // The Node build carries the helper; it is local and sends no request.
    const client: object = algoliasearch("TESTAPP", PARENT);
    if (
      !("generateSecuredApiKey" in client) ||
      typeof client.generateSecuredApiKey !== "function"
    )
      throw new Error("algoliasearch no longer has generateSecuredApiKey");
    for (const tier of ["free", "full"] as const) {
      const restrictions = SearchApiKey.restrictions({
        tier,
        visitor: "203.0.113.7",
        nowMs: NOW,
      });
      expect(mint(tier).apiKey).toBe(
        client.generateSecuredApiKey({ parentApiKey: PARENT, restrictions }),
      );
    }
  });

  test("free keys force the first page of 24 results", () => {
    const grant = mint("free");
    const { params } = decode(grant.apiKey);
    expect(params.get("hitsPerPage")).toBe("24");
    expect(params.get("page")).toBe("0");
    expect(grant.tier).toBe("free");
  });

  test("paid keys leave pagination to the page", () => {
    for (const tier of ["lite", "full"] as const) {
      const { params } = decode(mint(tier).apiKey);
      expect(params.has("hitsPerPage")).toBe(false);
      expect(params.has("page")).toBe(false);
    }
  });

  test("every key reads only this deployment's indices and expires in an hour", () => {
    const grant = mint("full");
    const { params } = decode(grant.apiKey);
    expect(params.get("restrictIndices")?.split(",")).toEqual([
      "vehicles",
      "vehicles_oldest",
      "vehicles_year_desc",
      "vehicles_year_asc",
      "vehicles_newest",
    ]);
    expect(grant.validUntil).toBe(NOW / 1000 + 3600);
    expect(params.get("validUntil")).toBe(String(NOW / 1000 + 3600));
  });

  test("rate limits count per visitor through a hashed user token", () => {
    const token = decode(mint("free").apiKey).params.get("userToken");
    expect(token).toMatch(/^[0-9a-f]{32}$/);
    expect(token).not.toContain("203.0.113.7");
  });
});
