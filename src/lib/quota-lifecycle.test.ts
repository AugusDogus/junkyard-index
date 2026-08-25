import { describe, expect, test } from "bun:test";
import {
  initialQuotaLifecycleState,
  parseStoredQuotaRecord,
  quotaStatusForQuery,
  transitionQuotaLifecycle,
} from "./quota-lifecycle";

describe("quota lifecycle", () => {
  test("creates a guest before recording the first signed-out search", () => {
    const state = transitionQuotaLifecycle(initialQuotaLifecycleState, {
      type: "search_ready",
      query: "Honda Civic",
    });

    expect(state.phase).toEqual({
      kind: "creating_guest",
      query: "Honda Civic",
    });
    expect(quotaStatusForQuery(state, "Honda Civic")).toBe("verifying");
  });

  test("records a new query once an identity resolves", () => {
    const identified = transitionQuotaLifecycle(initialQuotaLifecycleState, {
      type: "viewer_resolved",
      userId: "guest-1",
      currentQuery: "Honda Civic",
      stored: null,
    });
    const recording = transitionQuotaLifecycle(identified, {
      type: "search_ready",
      query: "Honda Civic",
    });

    expect(recording.phase).toEqual({
      kind: "recording",
      userId: "guest-1",
      query: "Honda Civic",
    });
    expect(
      transitionQuotaLifecycle(recording, {
        type: "record_succeeded",
        userId: "guest-1",
        query: "Honda Civic",
        allowed: true,
      }).phase,
    ).toEqual({ kind: "idle", access: "allowed" });
  });

  test("blocks rendering after the server reports the limit exceeded", () => {
    const recording = {
      userId: "user-1",
      lastQuery: "Toyota",
      phase: {
        kind: "recording" as const,
        userId: "user-1",
        query: "Toyota",
      },
    };
    const blocked = transitionQuotaLifecycle(recording, {
      type: "record_succeeded",
      userId: "user-1",
      query: "Toyota",
      allowed: false,
    });

    expect(quotaStatusForQuery(blocked, "Toyota")).toBe("limit_exceeded");
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

describe("parseStoredQuotaRecord", () => {
  test("accepts only the current viewer and UTC day", () => {
    const raw = JSON.stringify({
      userId: "user-1",
      query: "Ford",
      exceeded: true,
      day: "2026-08-25",
    });

    expect(
      parseStoredQuotaRecord({
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
      parseStoredQuotaRecord({
        raw,
        today: "2026-08-26",
        userId: "user-1",
      }),
    ).toBeNull();
    expect(
      parseStoredQuotaRecord({
        raw,
        today: "2026-08-25",
        userId: "user-2",
      }),
    ).toBeNull();
  });
});
