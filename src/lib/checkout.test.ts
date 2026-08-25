import { describe, expect, test } from "bun:test";
import { subscriptionUrl } from "./checkout";

describe("subscriptionUrl", () => {
  test("encodes the selected tier and billing interval", () => {
    expect(subscriptionUrl("lite", "annual")).toBe(
      "/subscribe?tier=lite&interval=annual",
    );
  });
});
