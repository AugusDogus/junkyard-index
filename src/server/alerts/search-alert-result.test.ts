import { describe, expect, test } from "bun:test";
import { stringify } from "devalue";
import { SearchAlertResult } from "./search-alert-result";

describe("SearchAlertResult", () => {
  test("classifies completed and failed outcomes", () => {
    const completed = SearchAlertResult.completed(
      "search-1",
      "no_new_vehicles",
    );
    const failed = SearchAlertResult.notification({
      searchId: "search-2",
      newVehicleCount: 2,
      email: { kind: "failed", error: "provider unavailable" },
      discord: { kind: "sent" },
      canAdvanceLastCheckedAt: true,
    });

    expect(SearchAlertResult.hasError(completed)).toBe(false);
    expect(SearchAlertResult.hasError(failed)).toBe(true);
    expect(SearchAlertResult.notificationSent(failed)).toBe(true);
    expect(failed.checkpoint).toBe("not_advanced_delivery_error");
    expect(() => stringify(failed)).not.toThrow();

    const delivered = SearchAlertResult.notification({
      searchId: "search-3",
      newVehicleCount: 1,
      email: { kind: "sent" },
      discord: { kind: "not_enabled" },
      canAdvanceLastCheckedAt: true,
    });
    if (delivered.checkpoint !== "advanced") {
      throw new Error("Expected an advanced notification result");
    }
    const checkpointFailed = SearchAlertResult.checkpointPersistenceFailed(
      delivered,
      "database unavailable",
    );
    expect(SearchAlertResult.hasError(checkpointFailed)).toBe(true);
    expect(SearchAlertResult.notificationSent(checkpointFailed)).toBe(true);
    expect(() => stringify(checkpointFailed)).not.toThrow();
  });
});
