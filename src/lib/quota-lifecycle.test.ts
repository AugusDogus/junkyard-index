import { describe, expect, test } from "bun:test";
import {
  initialQuotaLifecycleState,
  parseStoredQuotaRecord,
  quotaStatusForQuery,
  transitionQuotaLifecycle,
} from "./quota-lifecycle";

describe("quota lifecycle", () => {
  test("creates a guest before recording the first signed-out search", () => {
    const creatingGuest = transitionQuotaLifecycle(initialQuotaLifecycleState, {
      type: "search_ready",
      query: "civic",
    });
    expect(creatingGuest.phase).toEqual({
      kind: "creating_guest",
      query: "civic",
    });

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
    expect(recording.phase).toEqual({
      kind: "recording",
      userId: "guest-1",
      query: "civic",
    });
  });

  test("retries guest creation on the next distinct search after failure", () => {
    const creatingGuest = transitionQuotaLifecycle(initialQuotaLifecycleState, {
      type: "search_ready",
      query: "civic",
    });
    const failed = transitionQuotaLifecycle(creatingGuest, {
      type: "guest_creation_failed",
    });
    expect(quotaStatusForQuery(failed, "civic")).toBe(
      "verification_unavailable",
    );

    expect(
      transitionQuotaLifecycle(failed, {
        type: "search_ready",
        query: "civic",
      }),
    ).toEqual(failed);
    const retrying = transitionQuotaLifecycle(failed, {
      type: "search_ready",
      query: "accord",
    });
    expect(retrying.phase).toEqual({
      kind: "creating_guest",
      query: "accord",
    });
    expect(quotaStatusForQuery(retrying, "accord")).toBe("verifying");
  });

  test("fails closed when recording cannot be verified", () => {
    const resolved = transitionQuotaLifecycle(initialQuotaLifecycleState, {
      type: "viewer_resolved",
      userId: "user-1",
      currentQuery: "civic",
      stored: null,
    });
    const recording = transitionQuotaLifecycle(resolved, {
      type: "search_ready",
      query: "civic",
    });
    const failed = transitionQuotaLifecycle(recording, {
      type: "record_failed",
      userId: "user-1",
      query: "civic",
    });

    expect(quotaStatusForQuery(failed, "civic")).toBe(
      "verification_unavailable",
    );
    expect(
      transitionQuotaLifecycle(failed, {
        type: "search_ready",
        query: "civic",
      }),
    ).toEqual(failed);

    const nextSearch = transitionQuotaLifecycle(failed, {
      type: "search_ready",
      query: "accord",
    });
    expect(quotaStatusForQuery(nextSearch, "accord")).toBe("verifying");
    expect(nextSearch.phase).toEqual({
      kind: "recording",
      userId: "user-1",
      query: "accord",
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

  test("keeps a new query hidden until quota recording succeeds", () => {
    expect(quotaStatusForQuery(initialQuotaLifecycleState, "civic")).toBe(
      "verifying",
    );
    const resolved = transitionQuotaLifecycle(initialQuotaLifecycleState, {
      type: "viewer_resolved",
      userId: "user-1",
      currentQuery: "",
      stored: null,
    });
    const recording = transitionQuotaLifecycle(resolved, {
      type: "search_ready",
      query: "civic",
    });
    expect(quotaStatusForQuery(recording, "civic")).toBe("verifying");

    const recorded = transitionQuotaLifecycle(recording, {
      type: "record_succeeded",
      userId: "user-1",
      query: "civic",
      allowed: true,
    });
    expect(quotaStatusForQuery(recorded, "civic")).toBe("allowed");
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
    expect(quotaStatusForQuery(blocked, "civic")).toBe("limit_exceeded");
    expect(
      quotaStatusForQuery(
        transitionQuotaLifecycle(blocked, { type: "paid_tier_resolved" }),
        "civic",
      ),
    ).toBe("allowed");

    const unavailable = {
      ...blocked,
      phase: {
        kind: "record_failed" as const,
        userId: "user-1",
        query: "civic",
      },
    };
    expect(
      quotaStatusForQuery(
        transitionQuotaLifecycle(unavailable, {
          type: "paid_tier_resolved",
        }),
        "civic",
      ),
    ).toBe("allowed");
  });

  test("ignores late quota results after paid access resolves", () => {
    const resolved = transitionQuotaLifecycle(initialQuotaLifecycleState, {
      type: "viewer_resolved",
      userId: "user-1",
      currentQuery: "",
      stored: null,
    });
    const recording = transitionQuotaLifecycle(resolved, {
      type: "search_ready",
      query: "civic",
    });
    const exempt = transitionQuotaLifecycle(recording, {
      type: "paid_tier_resolved",
    });

    expect(
      transitionQuotaLifecycle(exempt, {
        type: "record_succeeded",
        userId: "user-1",
        query: "civic",
        allowed: false,
      }),
    ).toEqual(exempt);
    expect(
      transitionQuotaLifecycle(exempt, {
        type: "record_failed",
        userId: "user-1",
        query: "civic",
      }),
    ).toEqual(exempt);
    expect(quotaStatusForQuery(exempt, "civic")).toBe("allowed");

    const downgraded = transitionQuotaLifecycle(exempt, {
      type: "free_tier_resolved",
    });
    expect(quotaStatusForQuery(downgraded, "civic")).toBe("verifying");
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
