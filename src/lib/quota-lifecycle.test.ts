import { describe, expect, test } from "bun:test";
import {
  initialQuotaLifecycleState,
  parseStoredAccountQuotaRecord,
  parseStoredBrowserQuotaRecord,
  quotaStatusForQuery,
  recordBrowserSearch,
  transitionQuotaLifecycle,
} from "./quota-lifecycle";

describe("quota lifecycle", () => {
  test("records the first signed-out search against the browser", () => {
    const state = transitionQuotaLifecycle(initialQuotaLifecycleState, {
      type: "search_ready",
      query: "Honda Civic",
    });

    expect(state.phase).toEqual({
      kind: "recording_browser",
      query: "Honda Civic",
    });
    expect(quotaStatusForQuery(state, "Honda Civic")).toBe("verifying");
  });

  test("records authenticated searches against the account", () => {
    const identified = transitionQuotaLifecycle(initialQuotaLifecycleState, {
      type: "viewer_resolved",
      userId: "user-1",
      currentQuery: "Honda Civic",
      stored: null,
    });
    const recording = transitionQuotaLifecycle(identified, {
      type: "search_ready",
      query: "Honda Civic",
    });

    expect(recording.phase).toEqual({
      kind: "recording_account",
      userId: "user-1",
      query: "Honda Civic",
    });
    expect(
      transitionQuotaLifecycle(recording, {
        type: "account_record_succeeded",
        userId: "user-1",
        query: "Honda Civic",
        allowed: true,
      }).phase,
    ).toEqual({ kind: "idle", access: "allowed" });
  });

  test("blocks rendering after either quota reports the limit exceeded", () => {
    const browserRecording = transitionQuotaLifecycle(
      initialQuotaLifecycleState,
      { type: "search_ready", query: "Toyota" },
    );
    const browserBlocked = transitionQuotaLifecycle(browserRecording, {
      type: "browser_record_succeeded",
      query: "Toyota",
      allowed: false,
    });
    expect(quotaStatusForQuery(browserBlocked, "Toyota")).toBe(
      "limit_exceeded",
    );

    const accountRecording = {
      userId: "user-1",
      lastQuery: "Toyota",
      phase: {
        kind: "recording_account" as const,
        userId: "user-1",
        query: "Toyota",
      },
    };
    const accountBlocked = transitionQuotaLifecycle(accountRecording, {
      type: "account_record_succeeded",
      userId: "user-1",
      query: "Toyota",
      allowed: false,
    });
    expect(quotaStatusForQuery(accountBlocked, "Toyota")).toBe(
      "limit_exceeded",
    );
  });

  test("paid tiers remain exempt", () => {
    const exempt = transitionQuotaLifecycle(initialQuotaLifecycleState, {
      type: "paid_tier_resolved",
    });

    expect(quotaStatusForQuery(exempt, "Ford")).toBe("allowed");
    expect(
      transitionQuotaLifecycle(exempt, {
        type: "search_ready",
        query: "Ford",
      }),
    ).toEqual(exempt);
  });
});

describe("stored quota records", () => {
  test("accepts account records only for the current viewer and UTC day", () => {
    const raw = JSON.stringify({
      userId: "user-1",
      query: "Ford",
      exceeded: true,
      day: "2026-08-25",
    });

    expect(
      parseStoredAccountQuotaRecord({
        raw,
        today: "2026-08-25",
        userId: "user-1",
      }),
    ).toEqual({
      userId: "user-1",
      query: "Ford",
      exceeded: true,
      day: "2026-08-25",
    });
    expect(
      parseStoredAccountQuotaRecord({
        raw,
        today: "2026-08-26",
        userId: "user-1",
      }),
    ).toBeNull();
  });

  test("accepts bounded browser records only for the current UTC day", () => {
    const raw = JSON.stringify({
      query: "Ford",
      count: 10,
      exceeded: false,
      day: "2026-08-25",
    });
    expect(parseStoredBrowserQuotaRecord({ raw, today: "2026-08-25" })).toEqual(
      {
        query: "Ford",
        count: 10,
        exceeded: false,
        day: "2026-08-25",
      },
    );
    expect(
      parseStoredBrowserQuotaRecord({ raw, today: "2026-08-26" }),
    ).toBeNull();
    expect(
      parseStoredBrowserQuotaRecord({
        raw: JSON.stringify({
          query: "Ford",
          count: -1,
          exceeded: false,
          day: "2026-08-25",
        }),
        today: "2026-08-25",
      }),
    ).toBeNull();
  });

  test("counts distinct browser queries and resets on a new UTC day", () => {
    let record = recordBrowserSearch({
      prior: null,
      query: "Ford",
      today: "2026-08-25",
    });
    expect(record).toEqual({
      query: "Ford",
      count: 1,
      exceeded: false,
      day: "2026-08-25",
    });

    record = recordBrowserSearch({
      prior: { ...record, count: 10 },
      query: "Toyota",
      today: "2026-08-25",
    });
    expect(record.count).toBe(11);
    expect(record.exceeded).toBe(true);

    expect(
      recordBrowserSearch({
        prior: record,
        query: "Honda",
        today: "2026-08-26",
      }),
    ).toEqual({
      query: "Honda",
      count: 1,
      exceeded: false,
      day: "2026-08-26",
    });
  });
});
