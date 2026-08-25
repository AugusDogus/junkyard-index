import { describe, expect, test } from "bun:test";
import {
  initialQuotaLifecycleState,
  parseStoredQuotaRecord,
  transitionQuotaLifecycle,
} from "./quota-lifecycle";

describe("quota lifecycle", () => {
  test("creates a guest before recording the first signed-out search", () => {
    const creatingGuest = transitionQuotaLifecycle(initialQuotaLifecycleState, {
      type: "search_ready",
      query: "civic",
    });
    expect(creatingGuest.activity).toEqual({ kind: "creating_guest" });

    const guestResolved = transitionQuotaLifecycle(creatingGuest, {
      type: "viewer_resolved",
      userId: "guest-1",
      currentQuery: "civic",
      stored: null,
    });
    const recording = transitionQuotaLifecycle(guestResolved, {
      type: "search_ready",
      query: "civic",
    });
    expect(recording.activity).toEqual({
      kind: "recording",
      userId: "guest-1",
      query: "civic",
    });
  });

  test("does not recount the current query after an account identity change", () => {
    const guest = transitionQuotaLifecycle(initialQuotaLifecycleState, {
      type: "viewer_resolved",
      userId: "guest-1",
      currentQuery: "civic",
      stored: null,
    });
    const recording = transitionQuotaLifecycle(guest, {
      type: "search_ready",
      query: "civic",
    });
    const recorded = transitionQuotaLifecycle(recording, {
      type: "record_succeeded",
      userId: "guest-1",
      query: "civic",
      allowed: true,
    });
    const linked = transitionQuotaLifecycle(recorded, {
      type: "viewer_resolved",
      userId: "user-1",
      currentQuery: "civic",
      stored: null,
    });
    expect(
      transitionQuotaLifecycle(linked, {
        type: "search_ready",
        query: "civic",
      }),
    ).toEqual(linked);
  });

  test("restores a same-day block and clears it for a paid tier", () => {
    const blocked = transitionQuotaLifecycle(initialQuotaLifecycleState, {
      type: "viewer_resolved",
      userId: "user-1",
      currentQuery: "civic",
      stored: {
        userId: "user-1",
        query: "civic",
        exceeded: true,
        day: "2026-08-24",
      },
    });
    expect(blocked.quotaExceeded).toBe(true);
    expect(
      transitionQuotaLifecycle(blocked, { type: "paid_tier_resolved" })
        .quotaExceeded,
    ).toBe(false);
  });

  test("ignores stale, malformed, and cross-account storage", () => {
    expect(
      parseStoredQuotaRecord({
        raw: "not json",
        today: "2026-08-24",
        userId: "user-1",
      }),
    ).toBeNull();
    expect(
      parseStoredQuotaRecord({
        raw: JSON.stringify({
          userId: "user-2",
          query: "civic",
          exceeded: true,
          day: "2026-08-24",
        }),
        today: "2026-08-24",
        userId: "user-1",
      }),
    ).toBeNull();
  });
});
