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

  test("rejects malformed non-ASCII tokens without throwing", () => {
    const malformedToken = "é".repeat(64);

    expect(() =>
      verifyUserUnsubscribeToken("user-1", malformedToken),
    ).not.toThrow();
    expect(verifyUserUnsubscribeToken("user-1", malformedToken)).toBe(false);
  });
});
