import { expect, test } from "bun:test";
import { parseRohnerArticle } from "./rohner-parser";
import type { RohnerArticleResult } from "./rohner-record";
import { classifyRohnerSnapshot } from "./rohner-snapshot";
import { rohnerFixture, rohnerNativeFixtures } from "./rohner-test-fixtures";

function passing(stock: string) {
  const fixture = rohnerFixture(stock);
  const result = parseRohnerArticle(fixture.html, fixture.url, fixture.cards);
  if (result.status !== "required-pass")
    throw new Error("Expected native required-pass fixture " + stock);
  return result;
}

test("Rohner separates native Sold-Rebuilder exclusions from required rejects and presence", () => {
  const snapshot = classifyRohnerSnapshot(
    rohnerNativeFixtures().articles.map((fixture) =>
      parseRohnerArticle(fixture.html, fixture.url, fixture.cards),
    ),
  );
  expect(snapshot.recordsProcessed).toBe(8);
  expect(snapshot.candidates).toHaveLength(7);
  expect(snapshot.rejected).toEqual([]);
  expect(snapshot.exclusions).toHaveLength(1);
  expect(snapshot.exclusions[0]?.reason).toBe("sold-rebuilder");
  expect(snapshot.exclusions[0]?.candidate.vin).toBe("RA29076797");
  expect(snapshot.observedValidVins).toContain("RA29076797");
  expect(snapshot.presentVins).not.toContain("RA29076797");
  expect(
    snapshot.candidates.map((candidate) => candidate.stockNumber),
  ).toContain("AA0279");
  expect(
    snapshot.candidates.map((candidate) => candidate.stockNumber),
  ).toContain("AA0185");
});

test("Rohner conflict quarantine takes precedence over a Sold-Rebuilder exclusion", () => {
  const sold = passing("aa0126");
  const conflict: RohnerArticleResult = {
    ...sold,
    status: "identity-conflict",
    candidate: null,
    reasons: ["Conflicting native year"],
  };
  const snapshot = classifyRohnerSnapshot([sold, conflict]);
  expect(snapshot.candidates).toEqual([]);
  expect(snapshot.exclusions).toEqual([]);
  expect(snapshot.rejected).toHaveLength(2);
  expect(snapshot.presentVins).toEqual(["RA29076797"]);
});

test("Rohner propagates connected destination conflicts to every native VIN, including rejected rows", () => {
  const first = passing("aa0304");
  const second = passing("aa0303");
  const third = passing("aa0268");
  const rejectedSecond: RohnerArticleResult = {
    ...second,
    status: "identity-conflict",
    candidate: null,
    claimedDestinations: [second.detailsUrl, first.detailsUrl],
    reasons: ["Conflicting canonical destination"],
  };
  const rejectedThird: RohnerArticleResult = {
    ...third,
    status: "identity-conflict",
    candidate: null,
    claimedDestinations: [third.detailsUrl, second.detailsUrl],
    reasons: ["Conflicting canonical destination"],
  };
  const snapshot = classifyRohnerSnapshot([
    first,
    rejectedSecond,
    rejectedThird,
  ]);
  const vins = [
    first.candidate.vin,
    second.candidate.vin,
    third.candidate.vin,
  ].sort();
  expect(snapshot.candidates).toEqual([]);
  expect(snapshot.rejected).toHaveLength(3);
  expect(snapshot.quarantinedVins).toEqual(vins);
  expect(snapshot.observedValidVins).toEqual(vins);
  expect(snapshot.presentVins).toEqual(vins);
});

test("Rohner deduplicates identical VIN records while preserving different donors with the same optional stock", () => {
  const first = passing("aa0304");
  const second = passing("aa0303");
  const duplicate = classifyRohnerSnapshot([first, first]);
  expect(duplicate.candidates).toHaveLength(1);
  expect(duplicate.duplicateExtras).toBe(1);
  expect(duplicate.quarantinedVins).toEqual([]);
  const snapshot = classifyRohnerSnapshot([
    { ...first, candidate: { ...first.candidate, stockNumber: "shared" } },
    { ...second, candidate: { ...second.candidate, stockNumber: "shared" } },
  ]);
  expect(snapshot.candidates).toHaveLength(2);
  expect(snapshot.duplicateExtras).toBe(0);
});
