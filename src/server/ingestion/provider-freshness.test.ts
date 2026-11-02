import { describe, expect, test } from "bun:test";
import { INGESTION_SOURCES } from "~/lib/ingestion-source";
import { providerFreshness } from "./provider-freshness";

const now = new Date("2026-11-02T12:00:00.000Z");
const hoursAgo = (hours: number) => now.getTime() - hours * 60 * 60 * 1000;

describe("providerFreshness", () => {
  test("reports every source, staling those without a recent publication", () => {
    const providers = providerFreshness(
      [
        {
          source: "pyp",
          lastAttemptAt: hoursAgo(5),
          lastPublishedAt: hoursAgo(5),
        },
        {
          source: "pullnsave",
          lastAttemptAt: hoursAgo(1),
          lastPublishedAt: null,
        },
      ],
      now,
    );

    expect(providers.map((provider) => provider.source)).toEqual([
      ...INGESTION_SOURCES,
    ]);
    const freshness = Object.fromEntries(
      providers.map((provider) => [provider.source, provider.fresh]),
    );
    expect(freshness.pyp).toBe(true);
    expect(freshness.pullnsave).toBe(false);
    // No run in the window at all, e.g. a disabled source.
    expect(freshness.row52).toBe(false);
  });
});
