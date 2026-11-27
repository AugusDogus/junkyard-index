import { describe, expect, test } from "bun:test";
import { stepFailureMessage } from "./step-errors";

// Sentry keeps the first 16,384 characters of an event message.
const SENTRY_MESSAGE_MAX = 16_384;

describe("stepFailureMessage", () => {
  test("names the operation and its cause", () => {
    expect(stepFailureMessage("Plan ingestion pass 1", new Error("down"))).toBe(
      "Plan ingestion pass 1 failed: down",
    );
  });

  test("keeps the cause ahead of a large cursor and bounds the cursor", () => {
    const cursor = {
      source: "beavers",
      pages: Array.from({ length: 2_000 }, (_, page) => ({
        url: `https://yard.example/VehicleDealerSearch?page=${page}`,
      })),
    };
    const cause =
      "Beaver's https://yard.example/VehicleDealerShowParts/1: fetch failed.";

    const context = `Cursor: ${JSON.stringify(cursor)}`;
    expect(context.length).toBeGreaterThan(SENTRY_MESSAGE_MAX);

    const message = stepFailureMessage(
      "Vehicle source chunk beavers",
      new Error(cause),
      context,
    );

    expect(message).toBe(
      `Vehicle source chunk beavers failed: ${cause}\n${context.slice(0, 500)}... (${context.length.toLocaleString("en-US")} characters)`,
    );
  });

  test("keeps a short context whole", () => {
    expect(
      stepFailureMessage("Vehicle source chunk pratt", "down", "Cursor: {}"),
    ).toBe("Vehicle source chunk pratt failed: down\nCursor: {}");
  });
});
