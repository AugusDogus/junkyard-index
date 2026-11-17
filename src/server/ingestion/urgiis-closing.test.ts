import { expect, test } from "bun:test";
import { urgiisBadgeLimit, urgiisClosingEvidence } from "./urgiis-closing";
import type { UrgiisEntry } from "./urgiis-traversal";
import type { UrgiisRecord } from "./urgiis-schema";

const record: UrgiisRecord = {
  years: [],
  titles: [],
  vins: [],
  inquiries: [],
  destinations: [],
  stock: null,
  image: null,
  date: null,
};
const menu = (counts: readonly number[]): UrgiisEntry => ({
  kind: "menu",
  url: "https://example.com/parts/ACURA",
  bytes: 100,
  controls: counts.map((count, i) => ({
    path: `/parts/ACURA/M${i}/`,
    label: `M${i}`,
    count,
  })),
});
const models = (sizes: readonly number[]): UrgiisEntry[] =>
  sizes.map((size, i) => ({
    kind: "model",
    freshness: { kind: "read", readAt: 0 },
    url: `https://example.com/parts/ACURA/M${i}/`,
    bytes: 100,
    records: Array.from({ length: size }, () => record),
  }));

test("URG IIS bounds absolute badge drift by the enumerated cards, not badge totals", () => {
  const entries: UrgiisEntry[] = [
    ...models([300, 300, 300, 100]),
    {
      kind: "makes",
      url: "https://example.com/parts/makes/",
      bytes: 100,
      controls: [{ path: "/parts/ACURA", label: "ACURA", count: 1000000 }],
    },
  ];
  expect(urgiisBadgeLimit(entries)).toBe(10);
  expect(urgiisBadgeLimit(models([399]))).toBe(3);
  expect(urgiisBadgeLimit(models([400]))).toBe(4);
  expect(
    urgiisClosingEvidence(menu([100, 100]), menu([105, 95]), entries, {
      makes: 0,
      models: 0,
    }),
  ).toEqual({ kind: "valid", badgeDrift: { makes: 0, models: 10 } });
  expect(
    urgiisClosingEvidence(menu([100, 100]), menu([106, 95]), entries, {
      makes: 0,
      models: 0,
    }).kind,
  ).toBe("drift");
});

test("URG IIS rejects growth reaching the advertised or observed native cap", () => {
  for (const [before, after, observed] of [
    [499, 500, 1],
    [500, 501, 1],
    [499, 500, 0],
    [1, 2, 499],
  ] as const) {
    expect(
      urgiisClosingEvidence(menu([before]), menu([after]), models([observed]), {
        makes: 0,
        models: 0,
      }),
    ).toMatchObject({
      kind: "drift",
      message: expect.stringContaining("500-card"),
    });
  }
  expect(
    urgiisClosingEvidence(menu([498]), menu([499]), models([498]), {
      makes: 0,
      models: 0,
    }).kind,
  ).toBe("valid");
  expect(
    urgiisClosingEvidence(menu([500]), menu([500]), models([1]), {
      makes: 0,
      models: 0,
    }).kind,
  ).toBe("valid");
});

test("URG IIS rejects disappearing models even when their badge is zero", () => {
  expect(
    urgiisClosingEvidence(menu([1, 0]), menu([1]), models([1, 0]), {
      makes: 0,
      models: 0,
    }).kind,
  ).toBe("drift");
});

test("URG IIS blocks an empty model whose closing badge reaches the small-model threshold", () => {
  expect(
    urgiisClosingEvidence(menu([1]), menu([2]), models([0]), {
      makes: 0,
      models: 0,
    }),
  ).toMatchObject({
    kind: "drift",
    message: expect.stringContaining("explicit empty result"),
  });
  expect(
    urgiisClosingEvidence(menu([0]), menu([1]), models([0]), {
      makes: 0,
      models: 0,
    }).kind,
  ).toBe("valid");
});
