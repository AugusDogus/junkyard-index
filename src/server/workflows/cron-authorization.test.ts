import { describe, expect, test } from "bun:test";
import { hasValidCronAuthorization } from "./cron-authorization";

describe("hasValidCronAuthorization", () => {
  test("accepts the configured bearer token", () => {
    expect(
      hasValidCronAuthorization(
        "Bearer a-secure-cron-secret",
        "a-secure-cron-secret",
      ),
    ).toBe(true);
  });

  test("rejects missing and mismatched credentials", () => {
    expect(hasValidCronAuthorization(null, "a-secure-cron-secret")).toBe(false);
    expect(
      hasValidCronAuthorization("Bearer wrong", "a-secure-cron-secret"),
    ).toBe(false);
    expect(hasValidCronAuthorization("Bearer anything", undefined)).toBe(false);
  });
});
