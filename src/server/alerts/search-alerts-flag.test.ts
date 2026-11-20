import { describe, expect, spyOn, test } from "bun:test";
import { Reason } from "@vercel/flags-core";
import { SearchAlertsFlag } from "./search-alerts-flag";

describe("SearchAlertsFlag.resolve", () => {
  test("runs alerts only while the flag serves true", () => {
    expect(
      SearchAlertsFlag.resolve({
        value: true,
        variantId: "on",
        reason: Reason.FALLTHROUGH,
      }),
    ).toBe("enabled");
    expect(
      SearchAlertsFlag.resolve({
        value: false,
        variantId: "off",
        reason: Reason.FALLTHROUGH,
      }),
    ).toBe("disabled");
  });

  test("pauses alerts when the flag is missing, unreadable or not a boolean", () => {
    const consoleError = spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(
        SearchAlertsFlag.resolve({
          value: true,
          variantId: null,
          reason: Reason.ERROR,
          errorMessage: "Failed to get OIDC token",
        }),
      ).toBe("disabled");
      expect(
        SearchAlertsFlag.resolve({
          value: "on",
          variantId: "on",
          reason: Reason.FALLTHROUGH,
        }),
      ).toBe("disabled");
    } finally {
      consoleError.mockRestore();
    }
  });
});
