import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  HYPERBROWSER_CONCURRENT_SESSIONS,
  HYPERBROWSER_SESSION_TIMEOUT_MINUTES,
  HYPERBROWSER_SOURCES,
  HyperbrowserConcurrency,
  HyperbrowserSessions,
} from "./hyperbrowser-sessions";
import { ProviderCapacityDeferred } from "./provider-chunk-clock";

test("every Hyperbrowser source shares one cap on concurrent sessions, with a lease that outlives its session", () => {
  const policies = HYPERBROWSER_SOURCES.map(HyperbrowserSessions.policy);
  expect(new Set(policies.map((policy) => policy.key)).size).toBe(
    HYPERBROWSER_SOURCES.length,
  );
  for (const policy of policies) {
    expect(policy.group).toEqual({
      key: "hyperbrowser",
      activeLanes: HYPERBROWSER_CONCURRENT_SESSIONS,
    });
    // A holder that dies keeps its place until Hyperbrowser has stopped the
    // session it opened.
    expect(policy.leaseMs).toBeGreaterThan(
      HYPERBROWSER_SESSION_TIMEOUT_MINUTES * 60_000,
    );
  }
});

test("the plan's concurrent session limit comes from HYPERBROWSER_CONCURRENT_SESSIONS, 1 when unset", () => {
  expect(HyperbrowserConcurrency.parse(undefined)).toBe(1);
  expect(HyperbrowserConcurrency.parse("")).toBe(1);
  // Startup's limit, set after the upgrade without a code change.
  expect(HyperbrowserConcurrency.parse("25")).toBe(25);
  for (const raw of ["0", "-1", "2.5", "25 ", "many", "1000"])
    expect(() => HyperbrowserConcurrency.parse(raw)).toThrow(
      "HYPERBROWSER_CONCURRENT_SESSIONS must be the Hyperbrowser plan's concurrent session limit",
    );
});

/** An SDK request failure as `@hyperbrowser/sdk` 0.83 throws it. */
const sdkError = (message: string, statusCode: number) =>
  Object.assign(new Error("[Hyperbrowser]: " + message), {
    name: "HyperbrowserError",
    statusCode,
  });

test("the plan's concurrent session refusal defers the chunk; other create failures do not", () => {
  // The refusal production saw on 2026-11-18 to 2026-11-20.
  const refusal = sdkError(
    "Maximum number of active sessions (1) reached. Please close some sessions before creating new ones.",
    429,
  );
  const deferral = HyperbrowserSessions.capacityDeferral(refusal);
  expect(deferral).toBeInstanceOf(ProviderCapacityDeferred);
  expect(deferral?.message).toContain("Maximum number of active sessions (1)");
  expect(
    HyperbrowserSessions.capacityDeferral(sdkError("Invalid API key", 401)),
  ).toBeNull();
  expect(
    HyperbrowserSessions.capacityDeferral(
      new Error("Maximum number of active sessions (1) reached."),
    ),
  ).toBeNull();
});

test("every session is created with the timeout its lease outlives", async () => {
  const created: unknown[] = [];
  await HyperbrowserSessions.create(
    {
      sessions: {
        create: async (params) => {
          created.push(params);
          return { id: "s1", wsEndpoint: "wss://browser/1" };
        },
      },
    },
    { useStealth: true },
  );
  expect(created).toEqual([
    {
      useStealth: true,
      timeoutMinutes: HYPERBROWSER_SESSION_TIMEOUT_MINUTES,
    },
  ]);
});

test("every ingestion module that creates a Hyperbrowser session takes the session lease", () => {
  const sources = readdirSync(import.meta.dir)
    .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"))
    .map((file) => [file, readFileSync(join(import.meta.dir, file), "utf8")]);
  const creators = sources.filter(([, source]) =>
    source?.includes("HyperbrowserSessions.create("),
  );
  expect(creators.map(([file]) => file).sort()).toEqual([
    "document-transport.ts",
    "upullit-davie-browser-session.ts",
    "vanderhaags-browser-session.ts",
  ]);
  for (const [file, source] of creators)
    expect([file, source?.includes("HyperbrowserSessions.lease(")]).toEqual([
      file,
      true,
    ]);
  // Only the lease module creates sessions directly.
  expect(
    sources
      .filter(([, source]) => /\.sessions\.create\(/.test(source ?? ""))
      .map(([file]) => file),
  ).toEqual(["hyperbrowser-sessions.ts"]);
});
