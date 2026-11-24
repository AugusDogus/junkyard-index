import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { Effect } from "effect";
import { kernelBrowserUsage } from "~/schema";
import { DocumentTransport, type BrowserSessions } from "./document-transport";
import { KernelApiError } from "./kernel-sessions";
import {
  KERNEL_DAILY_BUDGET_USD,
  KERNEL_MONTHLY_BUDGET_USD,
  KERNEL_USD_PER_SECOND,
  KernelBudgetSpent,
  KernelUsage,
} from "./kernel-usage";
import { ProviderCapacityDeferred } from "./provider-chunk-clock";

let client: Client;
beforeEach(async () => {
  client = createClient({ url: ":memory:" });
  await client.executeMultiple(
    readFileSync(
      new URL(
        "../../../drizzle/0031_kernel_browser_usage.sql",
        import.meta.url,
      ),
      "utf8",
    ).replaceAll("--> statement-breakpoint", ""),
  );
});
afterEach(() => client.close());

/** Fake Kernel sessions that record creates and deletes. */
function fakeSessions(
  options: { create?: () => Promise<never>; stop?: () => Promise<never> } = {},
) {
  const calls: string[] = [];
  let created = 0;
  const sessions: BrowserSessions = {
    provider: "kernel",
    lease: Effect.void,
    create: async () => {
      calls.push("create");
      if (options.create) return options.create();
      created += 1;
      return { id: `browser-${created}`, wsEndpoint: "wss://kernel.invalid" };
    },
    stop: async (id) => {
      calls.push(`stop ${id}`);
      if (options.stop) return options.stop();
    },
    connect: () => Promise.reject(new Error("not used")),
  };
  return { sessions, calls };
}

const at = (iso: string) => new Date(iso);
const headful = KERNEL_USD_PER_SECOND.headful;

async function insertUsage(
  id: string,
  startedAt: string,
  endedAt: string | null,
  source = "upullrparts",
  mode: "headless" | "headful" = "headful",
) {
  await client.execute({
    sql: "insert into kernel_browser_usage (id, source, mode, started_at, ended_at) values (?, ?, ?, ?, ?)",
    args: [
      id,
      source,
      mode,
      Date.parse(startedAt),
      endedAt === null ? null : Date.parse(endedAt),
    ],
  });
}

describe("KernelUsage.monthToDateUsd", () => {
  test("bills each of the source's browsers this UTC month by its seconds at its mode's rate", async () => {
    await insertUsage(
      "last-month",
      "2026-10-31T23:00:00Z",
      "2026-10-31T23:10:00Z",
    );
    await insertUsage("a", "2026-11-02T07:00:00Z", "2026-11-02T07:01:00Z");
    await insertUsage("b", "2026-11-05T07:00:00Z", "2026-11-05T07:00:30Z");
    await insertUsage(
      "other",
      "2026-11-05T07:00:00Z",
      "2026-11-05T08:00:00Z",
      "bigd",
    );
    expect(
      await KernelUsage.monthToDateUsd(
        drizzle(client),
        "upullrparts",
        at("2026-11-20T00:00:00Z"),
      ),
    ).toBeCloseTo(90 * headful, 10);
  });

  test("counts a browser never closed until now, at most its longest possible life", async () => {
    await insertUsage("open", "2026-11-02T07:00:00Z", null);
    const db = drizzle(client);
    expect(
      await KernelUsage.monthToDateUsd(
        db,
        "upullrparts",
        at("2026-11-02T07:00:10Z"),
      ),
    ).toBeCloseTo(10 * headful, 10);
    // The chunk wall limit (360 s) plus Kernel's 60 s inactivity timeout.
    expect(
      await KernelUsage.monthToDateUsd(
        db,
        "upullrparts",
        at("2026-11-03T00:00:00Z"),
      ),
    ).toBeCloseTo(420 * headful, 10);
  });
});

describe("KernelUsage.metered", () => {
  test("records each browser from before its create to its delete", async () => {
    const { sessions, calls } = fakeSessions();
    let now = at("2026-11-02T07:00:00Z");
    const metered = KernelUsage.metered(sessions, {
      database: drizzle(client),
      source: "upullrparts",
      now: () => now,
    });
    const created = await metered.create();
    now = at("2026-11-02T07:01:00Z");
    await metered.stop(created.id);
    expect(calls).toEqual(["create", "stop browser-1"]);
    const rows = await drizzle(client)
      .select({
        source: kernelBrowserUsage.source,
        mode: kernelBrowserUsage.mode,
        startedAt: kernelBrowserUsage.startedAt,
        endedAt: kernelBrowserUsage.endedAt,
      })
      .from(kernelBrowserUsage);
    expect(rows).toEqual([
      {
        source: "upullrparts",
        mode: "headful",
        startedAt: Date.parse("2026-11-02T07:00:00Z"),
        endedAt: Date.parse("2026-11-02T07:01:00Z"),
      },
    ]);
  });

  test("counts nothing for a create Kernel refused, and passes its refusal on", async () => {
    const refusal = new KernelApiError({
      operation: "create",
      status: 429,
      code: "org_limit_exceeded",
      detail: "full",
    });
    const { sessions } = fakeSessions({
      create: () => Promise.reject(refusal),
    });
    const metered = KernelUsage.metered(sessions, {
      database: drizzle(client),
      source: "upullrparts",
      now: () => at("2026-11-02T07:00:00Z"),
    });
    await expect(metered.create()).rejects.toBe(refusal);
    expect(
      await KernelUsage.monthToDateUsd(
        drizzle(client),
        "upullrparts",
        at("2026-11-03T00:00:00Z"),
      ),
    ).toBe(0);
  });

  test("counts a browser whose delete failed until Kernel's inactivity timeout deletes it", async () => {
    const { sessions } = fakeSessions({
      stop: () => Promise.reject(new Error("delete failed")),
    });
    const metered = KernelUsage.metered(sessions, {
      database: drizzle(client),
      source: "upullrparts",
      now: () => at("2026-11-02T07:00:00Z"),
    });
    const created = await metered.create();
    await expect(metered.stop(created.id)).rejects.toThrow("delete failed");
    expect(
      await KernelUsage.monthToDateUsd(
        drizzle(client),
        "upullrparts",
        at("2026-11-03T00:00:00Z"),
      ),
    ).toBeCloseTo(60 * headful, 10);
  });

  test("opens no browser once the month's spend reaches the budget, until the next month", async () => {
    // $3.30 at $0.48 an hour is 24,750 headful seconds.
    expect(KERNEL_MONTHLY_BUDGET_USD.upullrparts).toBe(3.3);
    await insertUsage("spent", "2026-11-02T00:00:00Z", "2026-11-02T06:52:30Z");
    const { sessions, calls } = fakeSessions();
    let now = at("2026-11-20T07:00:00Z");
    const metered = KernelUsage.metered(sessions, {
      database: drizzle(client),
      source: "upullrparts",
      now: () => now,
    });
    const refused = await metered.create().then(
      () => null,
      (error: unknown) => error,
    );
    expect(refused).toBeInstanceOf(KernelBudgetSpent);
    expect(calls).toEqual([]);
    expect(
      String(refused instanceof KernelBudgetSpent && refused.message),
    ).toBe(
      "U Pull R Parts has spent $3.30 of its $3.30 monthly Kernel budget since 2026-11-01 (kernel_browser_usage), so no browser was opened and the other Kernel sources keep the rest of Kernel's credit. Its chunks defer, opening no browser, until 2026-12-01, and a run still deferred after three hours fails, so the source shows as failing until then; raise KERNEL_MONTHLY_BUDGET_USD in kernel-usage.ts only if the Kernel dashboard shows credit to spare.",
    );

    now = at("2026-12-01T07:00:00Z");
    await metered.create();
    expect(calls).toEqual(["create"]);
  });

  test("opens no browser once the UTC day's spend reaches its daily cap, until the next day", async () => {
    // $0.25 at $0.48 an hour is 1,875 headful seconds.
    expect(KERNEL_DAILY_BUDGET_USD.upullrparts).toBe(0.25);
    await insertUsage(
      "yesterday",
      "2026-11-23T07:00:00Z",
      "2026-11-23T08:00:00Z",
    );
    await insertUsage("today", "2026-11-24T07:00:00Z", "2026-11-24T07:31:15Z");
    const { sessions, calls } = fakeSessions();
    let now = at("2026-11-24T09:00:00Z");
    const metered = KernelUsage.metered(sessions, {
      database: drizzle(client),
      source: "upullrparts",
      now: () => now,
    });
    const refused = await metered.create().then(
      () => null,
      (error: unknown) => error,
    );
    expect(refused).toBeInstanceOf(KernelBudgetSpent);
    expect(calls).toEqual([]);
    expect(
      String(refused instanceof KernelBudgetSpent && refused.message),
    ).toBe(
      "U Pull R Parts has spent $0.25 of its $0.25 daily Kernel cap since 2026-11-24 00:00 UTC (kernel_browser_usage), so no browser was opened; a full day's crawl costs about $0.03, so its chunks are most likely failing and retrying. Its chunks defer, opening no browser, until the cap resets at 2026-11-25 00:00 UTC; a run still deferred after three hours fails and the next scheduled run tries again, and prior inventory is preserved. Read the run's errors in /admin before raising KERNEL_DAILY_BUDGET_USD in kernel-usage.ts.",
    );

    now = at("2026-11-25T07:00:00Z");
    await metered.create();
    expect(calls).toEqual(["create"]);
  });

  test("defers the chunk, not fails it, when the budget is spent", async () => {
    await insertUsage("spent", "2026-11-02T00:00:00Z", "2026-11-03T00:00:00Z");
    const { sessions } = fakeSessions();
    const metered = KernelUsage.metered(sessions, {
      database: drizzle(client),
      source: "upullrparts",
      now: () => at("2026-11-20T07:00:00Z"),
    });
    const result = await Effect.runPromise(
      Effect.either(Effect.scoped(DocumentTransport.acquireSession(metered))),
    );
    expect(result).toMatchObject({ _tag: "Left" });
    const error = result._tag === "Left" ? result.left : null;
    expect(error).toBeInstanceOf(ProviderCapacityDeferred);
    expect(error?.message).toContain("until 2026-12-01");
  });
});

describe("603 Kernel caps", () => {
  test("each metered source spends only its own budgets, which add up to $3.90 of the $5 monthly credit", async () => {
    expect(KERNEL_MONTHLY_BUDGET_USD).toEqual({
      upullrparts: 3.3,
      six03: 0.6,
    });
    expect(
      Object.values(KERNEL_MONTHLY_BUDGET_USD).reduce((a, b) => a + b, 0),
    ).toBeCloseTo(3.9, 10);
    expect(KERNEL_DAILY_BUDGET_USD).toEqual({
      upullrparts: 0.25,
      six03: 0.15,
    });
    // U Pull R Parts has spent its whole daily cap; 603 has spent nothing.
    await insertUsage("today", "2026-11-24T07:00:00Z", "2026-11-24T07:31:15Z");
    const { sessions, calls } = fakeSessions();
    const metered = KernelUsage.metered(sessions, {
      database: drizzle(client),
      source: "six03",
      now: () => at("2026-11-24T09:00:00Z"),
    });
    await metered.create();
    expect(calls).toEqual(["create"]);
  });

  test("603 opens no browser once its UTC day's headless spend reaches its daily cap", async () => {
    // $0.15 at $0.06 an hour is 9,000 headless seconds.
    await insertUsage(
      "cold-census",
      "2026-11-24T07:00:00Z",
      "2026-11-24T09:30:00Z",
      "six03",
      "headless",
    );
    const { sessions, calls } = fakeSessions();
    const metered = KernelUsage.metered(sessions, {
      database: drizzle(client),
      source: "six03",
      now: () => at("2026-11-24T10:00:00Z"),
    });
    const refused = await metered.create().then(
      () => null,
      (error: unknown) => error,
    );
    expect(calls).toEqual([]);
    expect(
      String(refused instanceof KernelBudgetSpent && refused.message),
    ).toBe(
      "603 Auto Salvage has spent $0.15 of its $0.15 daily Kernel cap since 2026-11-24 00:00 UTC (kernel_browser_usage), so no browser was opened; a full day's crawl costs about $0.01, or about $0.05 for a cold census, so its chunks are most likely failing and retrying. Its chunks defer, opening no browser, until the cap resets at 2026-11-25 00:00 UTC; a run still deferred after three hours fails and the next scheduled run tries again, and prior inventory is preserved. Read the run's errors in /admin before raising KERNEL_DAILY_BUDGET_USD in kernel-usage.ts.",
    );
  });
});

describe("DocumentTransport.meteredSourceSessions", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });
  const keys = { hyperbrowserApiKey: "h", kernelApiKey: "k" };

  test.each(["six03"] as const)(
    "%s's Kernel browsers are recorded headless in kernel_browser_usage",
    async (source) => {
      const requests: string[] = [];
      globalThis.fetch = Object.assign(
        async (input: RequestInfo | URL, init?: RequestInit) => {
          requests.push(`${init?.method ?? "GET"} ${String(input)}`);
          return init?.method === "DELETE"
            ? new Response(null, { status: 200 })
            : Response.json({
                session_id: "kernel-1",
                cdp_ws_url: "wss://kernel.invalid/cdp",
              });
        },
        { preconnect: originalFetch.preconnect },
      );
      const sessions = DocumentTransport.meteredSourceSessions(
        source,
        keys,
        drizzle(client),
        "page",
      );
      expect(sessions.provider).toBe("kernel");
      const created = await sessions.create();
      await sessions.stop(created.id);
      expect(requests).toEqual([
        "POST https://api.onkernel.com/browsers",
        "DELETE https://api.onkernel.com/browsers/kernel-1",
      ]);
      const rows = await drizzle(client)
        .select({
          source: kernelBrowserUsage.source,
          mode: kernelBrowserUsage.mode,
          endedAt: kernelBrowserUsage.endedAt,
        })
        .from(kernelBrowserUsage);
      expect(rows).toEqual([
        { source, mode: "headless", endedAt: expect.any(Number) },
      ]);
    },
  );

  test.each([["six03", 0.6, "603 Auto Salvage"]] as const)(
    "%s sends nothing to Kernel once its monthly budget is spent",
    async (source, budgetUsd, name) => {
      const now = new Date();
      const monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
      const seconds = Math.ceil(budgetUsd / KERNEL_USD_PER_SECOND.headless);
      await client.execute({
        sql: "insert into kernel_browser_usage (id, source, mode, started_at, ended_at) values ('spent', ?, 'headless', ?, ?)",
        args: [source, monthStart, monthStart + seconds * 1_000],
      });
      globalThis.fetch = Object.assign(
        async () => {
          throw new Error("sent a request to Kernel");
        },
        { preconnect: originalFetch.preconnect },
      );
      const refused = await DocumentTransport.meteredSourceSessions(
        source,
        keys,
        drizzle(client),
        "page",
      )
        .create()
        .then(
          () => null,
          (error: unknown) => error,
        );
      expect(refused).toBeInstanceOf(KernelBudgetSpent);
      expect(
        String(refused instanceof KernelBudgetSpent && refused.message),
      ).toStartWith(
        `${name} has spent $${budgetUsd.toFixed(2)} of its $${budgetUsd.toFixed(2)} monthly Kernel budget`,
      );
    },
  );
});
