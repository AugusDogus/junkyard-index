import { describe, expect, test } from "bun:test";
import { DURABLE_INGESTION_SOURCES } from "./durable-source";
import { heavyTruckPartsHostPolicy } from "./heavytruckparts-host-slot";
import { HostClaims } from "./host-claims";
import {
  HYPERBROWSER_CONCURRENT_SESSIONS,
  HyperbrowserSessions,
} from "./hyperbrowser-sessions";
import { KERNEL_CONCURRENT_SESSIONS, KernelSessions } from "./kernel-sessions";
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

  test("claims a browser place from the source's browser provider", () => {
    expect(SourceHostClaims.of("bigd")).toEqual({
      lanes: [KernelSessions.policy("bigd").key],
      places: [{ group: "kernel", capacity: KERNEL_CONCURRENT_SESSIONS }],
    });
    expect(SourceHostClaims.of("michigantruck")).toEqual({
      lanes: [HyperbrowserSessions.policy("michigantruck").key],
      places: [
        { group: "hyperbrowser", capacity: HYPERBROWSER_CONCURRENT_SESSIONS },
      ],
    });
  });

  test("claims Northwest's URG lane and its browser place", () => {
    expect(SourceHostClaims.of("northwest")).toEqual({
      lanes: [
        sharedProviderHostPolicy("https://northwestautoparts.com")?.key ?? "",
        KernelSessions.policy("northwest").key,
      ],
      places: [
        urgPlace,
        { group: "kernel", capacity: KERNEL_CONCURRENT_SESSIONS },
      ],
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
