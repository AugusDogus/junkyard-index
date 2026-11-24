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
) {
  await client.execute({
    sql: "insert into kernel_browser_usage (id, source, mode, started_at, ended_at) values (?, ?, 'headful', ?, ?)",
    args: [
      id,
      source,
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
    // $3.50 at $0.48 an hour is 26,250 headful seconds.
    expect(KERNEL_MONTHLY_BUDGET_USD.upullrparts).toBe(3.5);
    await insertUsage("spent", "2026-11-02T00:00:00Z", "2026-11-02T07:17:30Z");
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
      "U Pull R Parts has spent $3.50 of its $3.50 monthly Kernel budget since 2026-11-01 (kernel_browser_usage), so no browser was opened and Big D and Northwest keep the rest of Kernel's credit. Its chunks defer until 2026-12-01; raise KERNEL_MONTHLY_BUDGET_USD in kernel-usage.ts only if the Kernel dashboard shows credit to spare.",
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
      "U Pull R Parts has spent $0.25 of its $0.25 daily Kernel cap since 2026-11-24 00:00 UTC (kernel_browser_usage), so no browser was opened; a full day's crawl costs about $0.03, so its chunks are most likely failing and retrying. Its chunks defer until the cap resets at 2026-11-25 00:00 UTC, and prior inventory is preserved. Read the run's errors in /admin before raising KERNEL_DAILY_BUDGET_USD in kernel-usage.ts.",
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
    expect(error?.message).toContain("Its chunks defer until 2026-12-01");
  });
});
