import { describe, expect, test } from "bun:test";
import { classifyDurableIngestionHealth } from "./durable-health";

describe("durable ingestion health", () => {
  test("recovers after transient execution errors when publication succeeds", () => {
    expect(
      classifyDurableIngestionHealth({
        status: "success",
        inventoryOutcome: "published",
        inventoryErrors: [],
      }),
    ).toBe("healthy");
  });

  test("distinguishes degraded publication from terminal failure", () => {
    expect(
      classifyDurableIngestionHealth({
        status: "running",
        inventoryOutcome: "published",
        inventoryErrors: [],
      }),
    ).toBe("down");
    expect(
      classifyDurableIngestionHealth({
        status: "success",
        inventoryOutcome: "published_degraded",
        inventoryErrors: ["provider snapshot rejected"],
      }),
    ).toBe("degraded");
  });
});
