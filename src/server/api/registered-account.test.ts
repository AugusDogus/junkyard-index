import { describe, expect, test } from "bun:test";
import { requireRegisteredAccount } from "./registered-account";

describe("requireRegisteredAccount", () => {
  test("rejects guest sessions before billing code can run", () => {
    try {
      requireRegisteredAccount({ isAnonymous: true });
      throw new Error("Expected guest authorization to fail.");
    } catch (error) {
      expect(error).toMatchObject({ code: "UNAUTHORIZED" });
    }
  });

  test("accepts registered sessions", () => {
    expect(() =>
      requireRegisteredAccount({ isAnonymous: false }),
    ).not.toThrow();
  });
});
