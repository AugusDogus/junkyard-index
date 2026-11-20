import { describe, expect, spyOn, test } from "bun:test";
import { Reason } from "@vercel/flags-core";
import { ConsumerFlags } from "./consumer-flags";

describe("ConsumerFlags.resolve", () => {
  test("pauses a consumer only while its flag serves false", () => {
    expect(ConsumerFlags.key("inventory-downstream")).toBe(
      "consumer-inventory-downstream",
    );
    expect(
      ConsumerFlags.resolve("maintenance", {
        value: false,
        variantId: "off",
        reason: Reason.FALLTHROUGH,
      }),
    ).toBe("paused");
    expect(
      ConsumerFlags.resolve("maintenance", {
        value: true,
        variantId: "on",
        reason: Reason.FALLTHROUGH,
      }),
    ).toBe("enabled");
  });

  test("keeps a consumer enabled when its flag is missing, unreadable or not a boolean", () => {
    const consoleError = spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(
        ConsumerFlags.resolve("notification-delivery", {
          value: true,
          variantId: null,
          reason: Reason.ERROR,
          errorMessage: "Failed to get OIDC token",
        }),
      ).toBe("enabled");
      expect(
        ConsumerFlags.resolve("inventory-downstream", {
          value: "off",
          variantId: "off",
          reason: Reason.FALLTHROUGH,
        }),
      ).toBe("enabled");
      expect(consoleError).toHaveBeenCalledTimes(2);
    } finally {
      consoleError.mockRestore();
    }
  });
});
