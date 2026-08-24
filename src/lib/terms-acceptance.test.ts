import { describe, expect, test } from "bun:test";
import { TERMS_METADATA } from "./legal";
import { TermsAcceptance } from "./terms-acceptance";

describe("Terms acceptance", () => {
  test("accepts current direct signup input without reading OAuth state", async () => {
    let oauthStateRead = false;

    await expect(
      TermsAcceptance.isAcceptedAtAuthBoundary({
        directVersion: TERMS_METADATA.version,
        readOAuthState: async () => {
          oauthStateRead = true;
          return null;
        },
      }),
    ).resolves.toBe(true);
    expect(oauthStateRead).toBe(false);
  });

  test("rejects missing and stale direct signup versions", () => {
    expect(TermsAcceptance.isCurrentVersion(undefined)).toBe(false);
    expect(TermsAcceptance.isCurrentVersion("2026-01-01")).toBe(false);
  });

  test("accepts the current version from OAuth state", () => {
    expect(
      TermsAcceptance.isCurrentOAuthState({
        termsVersion: TERMS_METADATA.version,
        callbackURL: "/search",
      }),
    ).toBe(true);
  });

  test("accepts OAuth signup without relying on an endpoint path", async () => {
    await expect(
      TermsAcceptance.isAcceptedAtAuthBoundary({
        directVersion: undefined,
        readOAuthState: async () => ({
          termsVersion: TERMS_METADATA.version,
          callbackURL: "/search",
        }),
      }),
    ).resolves.toBe(true);
  });

  test("rejects signup when neither auth path carries current acceptance", async () => {
    await expect(
      TermsAcceptance.isAcceptedAtAuthBoundary({
        directVersion: "2026-01-01",
        readOAuthState: async () => ({ termsVersion: "2026-01-01" }),
      }),
    ).resolves.toBe(false);
  });

  test("rejects malformed, missing, and stale OAuth state", () => {
    expect(TermsAcceptance.isCurrentOAuthState(null)).toBe(false);
    expect(TermsAcceptance.isCurrentOAuthState({})).toBe(false);
    expect(
      TermsAcceptance.isCurrentOAuthState({ termsVersion: "2026-01-01" }),
    ).toBe(false);
  });

  test("identifies attempts to overwrite acceptance evidence", () => {
    expect(
      TermsAcceptance.attemptsAcceptanceUpdate({
        termsVersion: "2026-01-01",
      }),
    ).toBe(true);
    expect(
      TermsAcceptance.attemptsAcceptanceUpdate({ termsAcceptedAt: null }),
    ).toBe(true);
    expect(TermsAcceptance.attemptsAcceptanceUpdate({ name: "Updated" })).toBe(
      false,
    );
  });
});
