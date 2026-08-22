import { describe, expect, test } from "bun:test";

process.env.SKIP_ENV_VALIDATION = "1";
process.env.UNSUBSCRIBE_SECRET =
  "test-unsubscribe-secret-at-least-32-characters";
process.env.RESEND_API_KEY = "re_test";

const {
  generateUnsubscribeToken,
  generateUserUnsubscribeToken,
  verifyUnsubscribeToken,
  verifyUserUnsubscribeToken,
  sanitizeEmailSubject,
} = await import("./email");

describe("unsubscribe tokens", () => {
  test("accepts generated search and user tokens", () => {
    expect(
      verifyUnsubscribeToken("search-1", generateUnsubscribeToken("search-1")),
    ).toBe(true);
    expect(
      verifyUserUnsubscribeToken(
        "user-1",
        generateUserUnsubscribeToken("user-1"),
      ),
    ).toBe(true);
  });

  test("rejects tokens across search and user authorization scopes", () => {
    const searchToken = generateUnsubscribeToken("user:user-1");
    const userToken = generateUserUnsubscribeToken("user-1");

    expect(verifyUserUnsubscribeToken("user-1", searchToken)).toBe(false);
    expect(verifyUnsubscribeToken("user:user-1", userToken)).toBe(false);
  });

  test("rejects malformed non-ASCII tokens without throwing", () => {
    const malformedToken = "é".repeat(64);

    expect(() =>
      verifyUserUnsubscribeToken("user-1", malformedToken),
    ).not.toThrow();
    expect(verifyUserUnsubscribeToken("user-1", malformedToken)).toBe(false);
  });
});

describe("sanitizeEmailSubject", () => {
  test("collapses CR/LF injection attempts to spaces", () => {
    expect(sanitizeEmailSubject("Yard\r\nBcc: hax@evil.com")).toBe(
      "Yard Bcc: hax@evil.com",
    );
  });

  test("strips tabs, form feeds, and vertical tabs", () => {
    expect(sanitizeEmailSubject("a\tb\fc\vd")).toBe("a b c d");
  });

  test("leaves clean subjects untouched", () => {
    expect(sanitizeEmailSubject("Yard Request: Ace Auto")).toBe(
      "Yard Request: Ace Auto",
    );
  });
});
