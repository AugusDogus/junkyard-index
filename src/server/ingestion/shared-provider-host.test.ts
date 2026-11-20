import { expect, spyOn, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Effect, Fiber, TestClock, TestContext } from "effect";
import {
  sharedProviderHostPolicy,
  sharedProviderHostSlot,
  URG_HOST_POLICY,
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

test("all URG tenants and native IIS origins share one backend, while VinPlus shares its API only", () => {
  for (const tenant of URGIIS_TENANTS)
    expect(sharedProviderHostPolicy(tenant.origin)).toBe(URG_HOST_POLICY);
  for (const host of [
    "aviationauto.com",
    "chazsauto.com",
    "aplusauto.parts",
    "centralautoliq.com",
    "northwestautoparts.com",
    "prattsautosalvage.com",
    "caltonautoparts.com",
    "dentonauto.com",
    "oemautorecyclers.com",
    "jimsimport.com",
    "hondapartsused.com",
    "pickapartva.com",
    "alln1kc.com",
    "grandpajohnsautoparts.com",
    "midwayupull.com",
    "indianriverautosalvage.com",
    "alliedautowrecking.com",
    "ifipull.com",
  ]) {
    expect(
      sharedProviderHostPolicy("https://www." + host + "/inventory/"),
    ).toBe(URG_HOST_POLICY);
  }
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

/** Top-level argument count of each `name(...)` call in `source`. */
function callArity(source: string, name: string): number[] {
  const arities: number[] = [];
  for (const match of source.matchAll(new RegExp(`\\b${name}\\(`, "g"))) {
    let depth = 1,
      commas = 0,
      trailing = false;
    for (let index = match.index + match[0].length; depth > 0; index++) {
      const character = source[index];
      if (character === undefined) break;
      if ("([{".includes(character)) depth++;
      else if (")]}".includes(character)) depth--;
      else if (character === "," && depth === 1) commas++;
      if (depth === 1 && character.trim() !== "") trailing = character === ",";
    }
    arities.push(commas + 1 - (trailing ? 1 : 0));
  }
  return arities;
}

test("a shared host turn around raw requests covers one request, and every request it shares a turn with takes a host slot", () => {
  // A turn holds the policy gap after its last request, and host slots inside
  // it keep the gap between requests. A raw request can therefore only be a
  // turn's single request: anything sharing its turn would follow it at once.
  const sources = new Map(
    readdirSync(import.meta.dir)
      .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"))
      .map((file) => [file, readFileSync(join(import.meta.dir, file), "utf8")]),
  );
  const raw = (source: string) =>
    /(?<![.\w])(fetch|fetchProviderResponse|fetchProviderText|fetchProviderJson)\(/.test(
      source,
    );
  const slotted = (source: string) =>
    source.includes("sharedProviderHostSlot(");
  const rawTurns: string[] = [];
  for (const [file, source] of sources) {
    const arities = callArity(source, "sharedProviderHostTurn");
    if (arities.length === 0) continue;
    if (raw(source)) {
      rawTurns.push(file);
      expect({ file, arities }).toEqual({
        file,
        arities: arities.map(() => 1),
      });
    }
    // Request helpers (fetch*, read*, request*) from modules that request
    // without a host slot would run inside a turn without the gap.
    for (const [, names = "", module] of source.matchAll(
      /import \{([^}]*)\} from "\.\/([\w-]+)"/g,
    )) {
      const imported = sources.get(module + ".ts");
      const requests = names
        .split(",")
        .map((name) => name.trim())
        .filter((name) => /^(fetch|read|request)/i.test(name));
      if (imported && raw(imported) && !slotted(imported))
        expect({ file, module, requests }).toEqual({
          file,
          module,
          requests: [],
        });
    }
  }
  expect(rawTurns).toEqual(["urgiis-client.ts"]);
});
