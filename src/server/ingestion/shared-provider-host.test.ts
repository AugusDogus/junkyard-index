import { expect, spyOn, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Effect, Fiber, TestClock, TestContext } from "effect";
import {
  sharedProviderHostPolicy,
  sharedProviderHostSlot,
  URG_HOST_GROUP,
  VINPLUS_HOST_POLICY,
} from "./shared-provider-host";
import { URGIIS_TENANTS } from "./urgiis-configuration";
import { readUrgiisPage } from "./urgiis-client";
import { fetchJolietSearch } from "./joliet-client";
import { fetchLittletonSearch } from "./littleton-client";
import { fetchPickersSearch } from "./pickers-client";
import { fetchPipesControl } from "./pipes-client";
import { fetchUwrenchSearch } from "./uwrench-client";
import { readVinplusControl } from "./vinplus-client";
import { VINPLUS_API } from "./vinplus-configuration";
import type { ProviderRequestGate } from "./provider-http-client";

const gate: ProviderRequestGate = (request) => request;

test("URG hosts share a lane only with hosts on the same origin server, while VinPlus shares its API only", () => {
  const lane = (host: string) =>
    sharedProviderHostPolicy("https://www." + host + "/inventory/");
  const servers = [
    [
      "aviationauto.com",
      "centralautoliq.com",
      "caltonautoparts.com",
      "jimsimport.com",
      "hondapartsused.com",
    ],
    ["lambertsalvage.com", "prattsautosalvage.com"],
    ["chazsauto.com"],
  ];
  const own = [
    ...URGIIS_TENANTS.map((tenant) => new URL(tenant.origin).hostname),
    "aplusauto.parts",
    "northwestautoparts.com",
    "dentonauto.com",
    "oemautorecyclers.com",
    "pickapartva.com",
    "alln1kc.com",
    "grandpajohnsautoparts.com",
    "midwayupull.com",
    "alliedautowrecking.com",
  ]
    .map((host) => host.replace(/^www\./, ""))
    .filter((host) => !servers.flat().includes(host));
  const lanes = [
    ...servers.map((hosts) => hosts.map(lane)),
    ...own.map((host) => [lane(host)]),
  ];
  for (const hosts of lanes) {
    const policy = hosts[0];
    if (!policy) throw new Error("Expected a URG lane for " + hosts.join());
    expect(policy.group).toBe(URG_HOST_GROUP);
    expect(policy.gapMs).toBe(3_500);
    for (const other of hosts) expect(other).toBe(policy);
  }
  // Distinct servers never share a lane.
  expect(new Set(lanes.map((hosts) => hosts[0]?.key)).size).toBe(lanes.length);
  expect(URG_HOST_GROUP.activeLanes).toBe(4);
  // Not URG sites: their clients pace them.
  expect(lane("ifipull.com")).toBeNull();
  expect(lane("indianriverautosalvage.com")).toBeNull();
  expect(sharedProviderHostPolicy(VINPLUS_API + "/searchVehicleHttp")).toBe(
    VINPLUS_HOST_POLICY,
  );
  expect(
    sharedProviderHostPolicy("https://vinplus.texnrewards.com/parts/joliet"),
  ).toBeNull();
  expect(sharedProviderHostPolicy("https://example.com/")).toBeNull();
});

test("deployed URG and every VinPlus API client fail closed without Redis", async () => {
  const vercel = process.env.VERCEL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  const fetch = spyOn(globalThis, "fetch").mockRejectedValue(
    new Error("No provider requests allowed"),
  );
  const pair = { make: "HONDA", model: "ACCORD" };
  try {
    process.env.VERCEL = "1";
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    const calls: readonly Effect.Effect<unknown, unknown>[] = [
      fetchJolietSearch(pair, gate),
      fetchLittletonSearch(pair, gate),
      fetchPickersSearch(pair, gate),
      fetchPipesControl({ kind: "query", pair }, gate),
      fetchUwrenchSearch(pair, gate, { used: 0 }),
      readVinplusControl(
        {
          url: VINPLUS_API + "/api/vehicle-groups",
          mime: "application/json",
          body: null,
        },
        gate,
      ),
    ];
    for (const call of calls)
      await expect(Effect.runPromise(call)).rejects.toThrow(
        "configuration failed",
      );
    const tenant = URGIIS_TENANTS[0];
    if (!tenant) throw new Error("Expected a configured URG tenant");
    await Effect.runPromise(
      Effect.gen(function* () {
        const fiber = yield* Effect.fork(
          Effect.either(
            readUrgiisPage(tenant.origin + tenant.ownerPath, tenant),
          ),
        );
        yield* TestClock.adjust("1 minute");
        expect((yield* Fiber.join(fiber))._tag).toBe("Left");
      }).pipe(Effect.provide(TestContext.TestContext)),
    );
    await expect(
      Effect.runPromise(sharedProviderHostSlot(tenant.origin)(Effect.void)),
    ).rejects.toThrow("configuration failed");
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    fetch.mockRestore();
    if (vercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = vercel;
    if (token === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN;
    else process.env.UPSTASH_REDIS_REST_TOKEN = token;
  }
});

/** Top-level declarations of a module by name, each with its text up to the
 * next top-level declaration. */
function declarations(source: string): ReadonlyMap<string, string> {
  const starts = [
    ...source.matchAll(
      /^(?:export )?(?:async )?(?:function\*? |const |let |class )(\w+)/gm,
    ),
  ];
  return new Map(
    starts.map((match, index) => [
      match[1] ?? "",
      source.slice(match.index, starts[index + 1]?.index),
    ]),
  );
}

/** A request that does not itself take a host slot: the global fetch, an
 * injected fetcher or a provider HTTP helper. */
const RAW_REQUEST =
  /(?<![.\w])(?:globalThis\.)?(?:fetch|fetcher|fetchImpl|fetchProviderResponse|fetchProviderText|fetchProviderJson)\(/;
const HOST_SLOT = /\bsharedProviderHost(?:Slot|Request)\(/;

/** Whether declaration `name`, or a declaration of the same module it uses,
 * makes a raw request that no host slot on the way wraps. */
function unslottedRequest(
  module: ReadonlyMap<string, string>,
  name: string,
  slotted = false,
  seen = new Set<string>(),
): boolean {
  const text = module.get(name);
  if (text === undefined || seen.has(name + slotted)) return false;
  seen.add(name + slotted);
  const covered = slotted || HOST_SLOT.test(text);
  if (!covered && RAW_REQUEST.test(text)) return true;
  return [...module.keys()].some(
    (other) =>
      other !== name &&
      new RegExp(`\\b${other}\\b`).test(text) &&
      unslottedRequest(module, other, covered, seen),
  );
}

test("every raw request that can share a shared host turn takes a host slot", () => {
  // A turn holds the policy gap after its last request. Inside it, only host
  // slots wait out the gap after the previous request and record their own
  // end (see the URG IIS spacing test), so a raw request without a slot would
  // follow or precede another request at once. A module that makes raw
  // requests therefore never opens a turn itself (sharedProviderHostRequest
  // gives one request its own slotted turn), and a turn's module may use
  // another module's declaration only if every raw request it reaches is
  // inside a host slot.
  const sources = new Map(
    readdirSync(import.meta.dir)
      .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"))
      .map((file) => [file, readFileSync(join(import.meta.dir, file), "utf8")]),
  );
  const modules = new Map(
    [...sources].map(([file, source]) => [
      file.slice(0, -".ts".length),
      declarations(source),
    ]),
  );
  const rawTurns: string[] = [];
  const unslotted: string[] = [];
  for (const [file, source] of sources) {
    if (!source.includes("sharedProviderHostTurn(")) continue;
    if (RAW_REQUEST.test(source)) rawTurns.push(file);
    for (const [, names = "", from = ""] of source.matchAll(
      /import \{([^}]*)\} from "\.\/([\w-]+)"/g,
    )) {
      const module = modules.get(from);
      if (!module) continue;
      for (const name of names.split(",")) {
        const declared = name
          .trim()
          .replace(/^type /, "")
          .split(/\s/)[0];
        if (declared && unslottedRequest(module, declared))
          unslotted.push(`${file} uses ${declared} from ${from}`);
      }
    }
  }
  expect(rawTurns).toEqual([]);
  expect(unslotted).toEqual([]);
});
