import { describe, expect, test } from "bun:test";
import {
  buildAlertResultStatus,
  parseSavedSearchFilters,
} from "./run-search-alerts-helpers";

describe("run-search-alerts helpers", () => {
  test("parses valid saved-search filters", () => {
    const result = parseSavedSearchFilters(
      JSON.stringify({
        makes: ["Honda"],
        minYear: 2015,
        sources: ["pyp"],
      }),
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.makes).toEqual(["Honda"]);
      expect(result.data.minYear).toBe(2015);
      expect(result.data.sources).toEqual(["pyp"]);
    }
  });

  test("rejects malformed JSON filters", () => {
    const result = parseSavedSearchFilters("{bad json");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.reason).toBe("malformed_json");
    }
  });

  test("rejects schema-invalid filters", () => {
    const result = parseSavedSearchFilters(
      JSON.stringify({ sources: ["not-a-source"] }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.reason).toBe("invalid_schema");
    }
  });

  test("builds status for successful notification delivery", () => {
    expect(
      buildAlertResultStatus({
        emailSent: true,
        discordSent: false,
        errors: [],
        canAdvanceLastCheckedAt: true,
      }),
    ).toBe("email_sent");
  });

  test("builds status for delivery errors with incomplete scan", () => {
    expect(
      buildAlertResultStatus({
        emailSent: false,
        discordSent: false,
        errors: ["Email failed: timeout"],
        canAdvanceLastCheckedAt: false,
      }),
    ).toBe(
      "error: Email failed: timeout, last_checked_not_advanced",
    );
  });

  test("builds status for complete scan with delivery errors", () => {
    expect(
      buildAlertResultStatus({
        emailSent: false,
        discordSent: true,
        errors: ["Email failed: provider unavailable"],
        canAdvanceLastCheckedAt: true,
      }),
    ).toBe(
      "error: Email failed: provider unavailable, discord_sent, last_checked_not_advanced_due_delivery_errors",
    );
  });
});
