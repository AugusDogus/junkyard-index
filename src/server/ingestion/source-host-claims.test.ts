import { describe, expect, test } from "bun:test";
import { DURABLE_INGESTION_SOURCES } from "./durable-source";
import { heavyTruckPartsHostPolicy } from "./heavytruckparts-host-slot";
import { HostClaims } from "./host-claims";
import {
  SHARED_PROVIDER_HOSTS,
  URG_HOST_GROUP,
  VINPLUS_HOST_POLICY,
  sharedProviderHostPolicy,
} from "./shared-provider-host";
import { SourceHostClaims } from "./source-host-claims";
import { URGIIS_TENANTS } from "./urgiis-configuration";

const urgPlace = {
  group: URG_HOST_GROUP.key,
  capacity: URG_HOST_GROUP.activeLanes,
};

describe("SourceHostClaims.of", () => {
  test("claims the lane and a URG place for a URG source", () => {
    expect(SourceHostClaims.of("pratt")).toEqual({
      lanes: [
        sharedProviderHostPolicy("https://prattsautosalvage.com")?.key ?? "",
      ],
      places: [urgPlace],
    });
  });

  test("puts sources that share a URG server in one lane", () => {
    expect(SourceHostClaims.of("aviation").lanes).toEqual(
      SourceHostClaims.of("calton").lanes,
    );
    expect(SourceHostClaims.of("central").lanes).toEqual(
      SourceHostClaims.of("jimsimport").lanes,
    );
    expect(SourceHostClaims.of("aviation").lanes).not.toEqual(
      SourceHostClaims.of("central").lanes,
    );
  });

  test("claims every URG IIS tenant lane, with one URG place", () => {
    const claims = SourceHostClaims.of("urgiis");
    expect(new Set(claims.lanes)).toEqual(
      new Set(
        URGIIS_TENANTS.map(
          (tenant) => sharedProviderHostPolicy(tenant.origin)?.key ?? "",
        ),
      ),
    );
    expect(claims.lanes).toContain(SourceHostClaims.of("pratt").lanes[0] ?? "");
    expect(claims.places).toEqual([urgPlace]);
  });

  test("puts every VinPlus source in the VinPlus lane", () => {
    for (const source of [
      "vinplus",
      "joliet",
      "littleton",
      "pickers",
      "pipes",
      "uwrench",
    ] as const)
      expect(SourceHostClaims.of(source)).toEqual({
        lanes: [VINPLUS_HOST_POLICY.key],
        places: [],
      });
  });

  test("puts every Heavy Truck Parts source in its lane", () => {
    for (const source of ["heavytruckparts", "cstruck", "dutchers"] as const)
      expect(SourceHostClaims.of(source)).toEqual({
        lanes: [heavyTruckPartsHostPolicy.key],
        places: [],
      });
  });

  test("claims no browser place, since the provider refuses chunks past its limit", () => {
    // A run sleeps for most of its day (block waits, cooldowns, budget
    // deferrals) with no browser open; KernelSessions.capacityDeferral turns
    // the plan's refusal into a deferred chunk instead.
    expect(HostClaims.isNone(SourceHostClaims.of("bigd"))).toBe(true);
    expect(HostClaims.isNone(SourceHostClaims.of("upullrparts"))).toBe(true);
    expect(HostClaims.isNone(SourceHostClaims.of("michigantruck"))).toBe(true);
  });

  test("claims only Northwest's URG lane", () => {
    expect(SourceHostClaims.of("northwest")).toEqual({
      lanes: [
        sharedProviderHostPolicy("https://northwestautoparts.com")?.key ?? "",
      ],
      places: [urgPlace],
    });
  });

  test("claims every shared host lane some source sends turns to", () => {
    const claimed = new Set(
      DURABLE_INGESTION_SOURCES.flatMap(
        (source) => SourceHostClaims.of(source).lanes,
      ),
    );
    for (const host of SHARED_PROVIDER_HOSTS) {
      const policy = sharedProviderHostPolicy("https://" + host);
      expect(policy && claimed.has(policy.key)).toBe(true);
    }
  });

  test("claims nothing for a source without a shared host", () => {
    expect(HostClaims.isNone(SourceHostClaims.of("row52"))).toBe(true);
  });
});

const tenantLane = (index: number) =>
  sharedProviderHostPolicy(URGIIS_TENANTS[index]?.origin ?? "")?.key ?? "";
const lambert = URGIIS_TENANTS.findIndex((tenant) => tenant.code === "lambert");

describe("SourceHostClaims for URG IIS progress", () => {
  test("admits a run for its current tenant's lane only", () => {
    expect(SourceHostClaims.next("urgiis", 0)).toEqual({
      lanes: [tenantLane(0)],
      places: [urgPlace],
    });
    // Lambert shares Pratt's server, so Pratt waits only while IIS reads it.
    expect(SourceHostClaims.next("urgiis", lambert).lanes).toEqual(
      SourceHostClaims.of("pratt").lanes,
    );
    expect(SourceHostClaims.next("urgiis", 0).lanes).not.toContain(
      SourceHostClaims.of("pratt").lanes[0],
    );
  });

  test("holds every unfinished tenant for a run another pass started", () => {
    // Its workflow may be on a deployment that crawls on without yielding.
    expect(SourceHostClaims.held("urgiis", lambert - 1).lanes).toEqual([
      ...new Set(
        URGIIS_TENANTS.slice(lambert - 1).map((_, i) =>
          tenantLane(lambert - 1 + i),
        ),
      ),
    ]);
    expect(SourceHostClaims.held("urgiis", lambert + 1).lanes).not.toContain(
      SourceHostClaims.of("pratt").lanes[0],
    );
  });

  test("claims nothing once every tenant is done", () => {
    const done = URGIIS_TENANTS.length;
    expect(HostClaims.isNone(SourceHostClaims.next("urgiis", done))).toBe(true);
    expect(HostClaims.isNone(SourceHostClaims.held("urgiis", done))).toBe(true);
  });

  test("ignores progress for a source with fixed lanes", () => {
    expect(SourceHostClaims.next("pratt", 3)).toEqual(
      SourceHostClaims.of("pratt"),
    );
    expect(SourceHostClaims.held("aviation", 3)).toEqual(
      SourceHostClaims.of("aviation"),
    );
  });
});

describe("SourceHostClaims.handBack", () => {
  test("names the next tenant's claims when it reads another lane", () => {
    expect(SourceHostClaims.handBack("urgiis", lambert - 1, lambert)).toEqual(
      SourceHostClaims.next("urgiis", lambert),
    );
  });

  test("hands nothing back within a tenant, at the end, or for fixed lanes", () => {
    expect(SourceHostClaims.handBack("urgiis", 2, 2)).toBeNull();
    expect(
      SourceHostClaims.handBack(
        "urgiis",
        URGIIS_TENANTS.length - 1,
        URGIIS_TENANTS.length,
      ),
    ).toBeNull();
    expect(SourceHostClaims.handBack("pratt", 0, 0)).toBeNull();
  });
});
