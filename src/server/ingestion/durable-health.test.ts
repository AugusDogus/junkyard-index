import { describe, expect, test } from "bun:test";
import { isDurableIngestionUnhealthy } from "./durable-health";

describe("durable ingestion health", () => {
  test("recovers after transient execution errors when publication succeeds", () => {
    expect(
      isDurableIngestionUnhealthy({
        status: "success",
        inventoryOutcome: "published",
        inventoryErrors: [],
      }),
    ).toBe(false);
  });

  test("keeps terminal and degraded inventory outcomes unhealthy", () => {
    expect(
      isDurableIngestionUnhealthy({
        status: "running",
        inventoryOutcome: "published",
        inventoryErrors: [],
      }),
    ).toBe(true);
    expect(
      isDurableIngestionUnhealthy({
        status: "success",
        inventoryOutcome: "published_degraded",
        inventoryErrors: ["provider snapshot rejected"],
      }),
    ).toBe(true);
  });
});
