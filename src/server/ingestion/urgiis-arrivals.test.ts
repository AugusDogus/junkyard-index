import { expect, test } from "bun:test";
import { URGIIS_TENANTS } from "./urgiis-configuration";
import { UrgiisReplayArchive } from "./urgiis-replay-archive";
import { iisCards } from "./urgiis-catalog";
import { urgiisArrivalDate, urgiisArrivalsCoverage } from "./urgiis-arrivals";
import type { UrgiisEntry } from "./urgiis-traversal";

test("saved purchase dates remain distinct from entry dates and bound the arrivals window", async () => {
  const tenant = URGIIS_TENANTS.find((t) => t.code === "linders");
  if (!tenant) throw new Error("Missing Linder's qualification");
  const archive = await UrgiisReplayArchive.open(tenant.code);
  try {
    await archive.next();
    await archive.next();
    const response = await archive.next();
    if (!response || response.url !== tenant.origin + tenant.arrivalsPath)
      throw new Error("Missing saved arrivals");
    const records = iisCards(response.html, tenant, "arrivals").records;
    expect(records).toHaveLength(60);
    expect(records[0]?.purchaseDate).toBe("2026-11-14");
    expect(records[0]?.date).toBeNull();
    const entries: UrgiisEntry[] = [
      { kind: "arrivals", url: response.url, bytes: 1, records },
    ];
    expect(urgiisArrivalsCoverage(entries, { entries, acceptedAt: 0 })).toEqual(
      { kind: "overflow", reason: "newer-oldest" },
    );
    expect(
      urgiisArrivalsCoverage(entries, {
        entries,
        acceptedAt: Date.UTC(2026, 10, 16),
      }),
    ).toEqual({ kind: "usable" });
    expect(
      urgiisArrivalsCoverage(entries, {
        entries: [],
        acceptedAt: Date.UTC(2026, 10, 16),
      }),
    ).toEqual({ kind: "overflow", reason: "all-new" });
    const first = records[0];
    if (!first) throw new Error("Missing dated card");
    expect(
      urgiisArrivalDate({ ...first, purchaseDate: "2026-02-30" }),
    ).toBeNull();
  } finally {
    archive.close();
  }
});
