import { expect, test } from "bun:test";
import { HyperbrowserSessions } from "./hyperbrowser-sessions";
import {
  KERNEL_CONCURRENT_SESSIONS,
  KERNEL_SESSION_TIMEOUT_SECONDS,
  KERNEL_SOURCES,
  KernelApiError,
  KernelConcurrency,
  KernelSessions,
} from "./kernel-sessions";
import {
  PROVIDER_CHUNK_WALL_LIMIT,
  ProviderCapacityDeferred,
} from "./provider-chunk-clock";
import { Duration } from "effect";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

test("every Kernel source shares one cap on concurrent browsers, apart from Hyperbrowser's, with a lease that outlives its browser", () => {
  const policies = KERNEL_SOURCES.map(KernelSessions.policy);
  expect(new Set(policies.map((policy) => policy.key)).size).toBe(
    KERNEL_SOURCES.length,
  );
  for (const policy of policies) {
    expect(policy.group).toEqual({
      key: "kernel",
      activeLanes: KERNEL_CONCURRENT_SESSIONS,
    });
    expect(policy.key).not.toBe(HyperbrowserSessions.policy("bigd").key);
    // A holder that dies keeps its place until Kernel has deleted the browser
    // it opened, after the chunk's wall limit and the inactivity timeout.
    expect(policy.leaseMs).toBeGreaterThan(
      Duration.toMillis(PROVIDER_CHUNK_WALL_LIMIT) +
        KERNEL_SESSION_TIMEOUT_SECONDS * 1_000,
    );
  }
});

test("the plan's concurrent browser limit comes from KERNEL_CONCURRENT_SESSIONS, 5 when unset", () => {
  expect(KernelConcurrency.parse(undefined)).toBe(5);
  expect(KernelConcurrency.parse("")).toBe(5);
  expect(KernelConcurrency.parse("10")).toBe(10);
  for (const raw of ["0", "-1", "2.5", "5 ", "many", "1000"])
    expect(() => KernelConcurrency.parse(raw)).toThrow(
      "KERNEL_CONCURRENT_SESSIONS must be the Kernel plan's concurrent browser limit",
    );
});

/** A fetch that records each request and answers with `respond`. */
function recording(respond: (url: string, init: RequestInit) => Response) {
  const requests: { url: string; init: RequestInit }[] = [];
  const request: typeof fetch = Object.assign(
    async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      requests.push({ url, init: init ?? {} });
      return respond(url, init ?? {});
    },
    { preconnect: fetch.preconnect },
  );
  return { request, requests };
}

const HEADLESS_DIRECT = { mode: "headless", egress: "direct" } as const;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

test("a browser is created stealth and headless with direct egress and the inactivity timeout, and its CDP URL is returned", async () => {
  const { request, requests } = recording(() =>
    json(200, {
      session_id: "k1",
      cdp_ws_url: "wss://browser.kernel/k1",
      headless: true,
    }),
  );
  expect(await KernelSessions.create("key", HEADLESS_DIRECT, request)).toEqual({
    id: "k1",
    wsEndpoint: "wss://browser.kernel/k1",
  });
  expect(requests).toHaveLength(1);
  const [created] = requests;
  expect(created?.url).toBe("https://api.onkernel.com/browsers");
  expect(created?.init.method).toBe("POST");
  expect(new Headers(created?.init.headers).get("authorization")).toBe(
    "Bearer key",
  );
  // Kernel's stealth proxy returned 502s and in-page network errors on
  // Northwest (November 23, 2026 soaks); direct egress, as Hyperbrowser ran,
  // read every page.
  expect(JSON.parse(String(created?.init.body))).toEqual({
    stealth: true,
    headless: true,
    timeout_seconds: KERNEL_SESSION_TIMEOUT_SECONDS,
    proxy: { mode: "direct" },
  });
});

test("a headful browser on the stealth proxy is created with headless off and no direct egress", async () => {
  const { request, requests } = recording(() =>
    json(200, { session_id: "k2", cdp_ws_url: "wss://browser.kernel/k2" }),
  );
  await KernelSessions.create(
    "key",
    { mode: "headful", egress: "stealthProxy" },
    request,
  );
  // Without `proxy`, `stealth` routes through Kernel's default stealth proxy.
  expect(JSON.parse(String(requests[0]?.init.body))).toEqual({
    stealth: true,
    headless: false,
    timeout_seconds: KERNEL_SESSION_TIMEOUT_SECONDS,
  });
});

test("sources run headless with direct egress, except U Pull R Parts: headful, whose Turnstile crashes headless, on the stealth proxy, which mints its tokens faster", () => {
  expect(
    Object.fromEntries(
      KERNEL_SOURCES.map((source) => [
        source,
        KernelSessions.browserProfile(source),
      ]),
    ),
  ).toEqual({
    bigd: HEADLESS_DIRECT,
    northwest: HEADLESS_DIRECT,
    six03: HEADLESS_DIRECT,
    citymotors: HEADLESS_DIRECT,
    michigantruck: HEADLESS_DIRECT,
    vanderhaags: HEADLESS_DIRECT,
    upullitdavie: HEADLESS_DIRECT,
    upullrparts: { mode: "headful", egress: "stealthProxy" },
  });
});

test("a refused create carries Kernel's status, code and message", async () => {
  const { request } = recording(() =>
    json(429, {
      code: "org_limit_exceeded",
      message:
        "org limit exceeded for unified_concurrent_sessions: limit=5, utilization=5, requested=1",
    }),
  );
  const failure = await KernelSessions.create(
    "key",
    HEADLESS_DIRECT,
    request,
  ).catch((error: unknown) => error);
  expect(failure).toEqual(
    new KernelApiError({
      operation: "create",
      status: 429,
      code: "org_limit_exceeded",
      detail:
        "org limit exceeded for unified_concurrent_sessions: limit=5, utilization=5, requested=1",
    }),
  );
});

test("a create response without a session or CDP URL fails instead of opening nothing", async () => {
  const { request } = recording(() => json(200, { session_id: "k1" }));
  await expect(
    KernelSessions.create("key", HEADLESS_DIRECT, request),
  ).rejects.toThrow();
});

test("stopping deletes the browser, and a browser Kernel already deleted counts as stopped", async () => {
  const { request, requests } = recording((url) =>
    url.endsWith("/gone")
      ? json(404, { code: "not_found", message: "browser not found" })
      : new Response(null, { status: 204 }),
  );
  await KernelSessions.stop("key", "k1", request);
  await KernelSessions.stop("key", "gone", request);
  expect(requests.map(({ url, init }) => [init.method, url])).toEqual([
    ["DELETE", "https://api.onkernel.com/browsers/k1"],
    ["DELETE", "https://api.onkernel.com/browsers/gone"],
  ]);
  const { request: failing } = recording(() =>
    json(500, { code: "internal", message: "try again" }),
  );
  await expect(KernelSessions.stop("key", "k1", failing)).rejects.toThrow(
    "Kernel browser delete returned HTTP 500 (internal): try again",
  );
});

const createError = (status: number, code: string | null) =>
  new KernelApiError({ operation: "create", status, code, detail: "refused" });

test("Kernel's concurrent browser, rate, capacity, plan and credit refusals defer the chunk; other failures do not", () => {
  // The refusal Kernel sent a sixth browser on the Developer plan, Nov 23.
  const deferral = KernelSessions.capacityDeferral(
    createError(429, "org_limit_exceeded"),
  );
  expect(deferral).toBeInstanceOf(ProviderCapacityDeferred);
  expect(deferral?.message).toContain("plan's concurrent browsers");
  expect(
    KernelSessions.capacityDeferral(createError(429, null)),
  ).toBeInstanceOf(ProviderCapacityDeferred);
  expect(
    KernelSessions.capacityDeferral(createError(529, null)),
  ).toBeInstanceOf(ProviderCapacityDeferred);
  // A spending cap, used-up monthly credit or plan limit refuses new browsers
  // with 403 until the next period or a higher cap. The source keeps its
  // checkpoint and retries; the run does not fail.
  const credit = KernelSessions.capacityDeferral(createError(403, null));
  expect(credit).toBeInstanceOf(ProviderCapacityDeferred);
  expect(credit?.message).toContain("spending cap");
  expect(credit?.message).toContain("monthly credit");
  expect(KernelSessions.capacityDeferral(createError(401, null))).toBeNull();
  expect(KernelSessions.capacityDeferral(createError(400, null))).toBeNull();
  expect(KernelSessions.capacityDeferral(createError(500, null))).toBeNull();
  expect(
    KernelSessions.capacityDeferral(
      new KernelApiError({
        operation: "delete",
        status: 429,
        code: null,
        detail: "refused",
      }),
    ),
  ).toBeNull();
  expect(
    KernelSessions.capacityDeferral(new Error("org_limit_exceeded")),
  ).toBeNull();
});

test("every ingestion module that creates a Kernel browser takes the Kernel lease", () => {
  const sources = readdirSync(import.meta.dir)
    .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"))
    .map((file) => [file, readFileSync(join(import.meta.dir, file), "utf8")]);
  const creators = sources.filter(([, source]) =>
    source?.includes("KernelSessions.create("),
  );
  expect(creators.map(([file]) => file)).toEqual(["document-transport.ts"]);
  for (const [file, source] of creators)
    expect([file, source?.includes("KernelSessions.lease(")]).toEqual([
      file,
      true,
    ]);
  // Only the lease module calls Kernel's browser API.
  expect(
    sources
      .filter(([, source]) => source?.includes("api.onkernel.com"))
      .map(([file]) => file),
  ).toEqual(["kernel-sessions.ts"]);
  // Session modules that drive their own page start a session through
  // `acquireSession`, which takes the lease itself; only document-transport.ts
  // calls a session lifecycle's `create` (not the Hyperbrowser SDK's
  // `client.sessions.create`, which hyperbrowser-sessions.ts guards), besides
  // kernel-usage.ts, whose `metered` wraps a lifecycle's `create` in one that
  // `acquireSession` still starts under the lease.
  expect(
    sources
      .filter(([, source]) => /(?<![.\w])sessions\.create\(/.test(source ?? ""))
      .map(([file]) => file)
      .sort(),
  ).toEqual(["document-transport.ts", "kernel-usage.ts"]);
});
