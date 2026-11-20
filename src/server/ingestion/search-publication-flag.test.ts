import { describe, expect, spyOn, test } from "bun:test";
import { Reason } from "@vercel/flags-core";
import { SearchPublicationFlag } from "./search-publication-flag";

describe("SearchPublicationFlag.resolve", () => {
  test("skips search publication only while the flag serves true", () => {
    expect(
      SearchPublicationFlag.resolve({
        value: true,
        variantId: "on",
        reason: Reason.FALLTHROUGH,
      }),
    ).toBe("skipped");
    expect(
      SearchPublicationFlag.resolve({
        value: false,
        variantId: "off",
        reason: Reason.FALLTHROUGH,
      }),
    ).toBe("inline");
  });

  test("publishes search inline when the flag is missing, unreadable or not a boolean", () => {
    const consoleError = spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(
        SearchPublicationFlag.resolve({
          value: true,
          variantId: null,
          reason: Reason.ERROR,
          errorMessage: "Failed to get OIDC token",
        }),
      ).toBe("inline");
      expect(
        SearchPublicationFlag.resolve({
          value: "on",
          variantId: "on",
          reason: Reason.FALLTHROUGH,
        }),
      ).toBe("inline");
      expect(consoleError).toHaveBeenCalledTimes(2);
    } finally {
      consoleError.mockRestore();
    }
  });
});
