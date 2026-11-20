import { describe, expect, test } from "bun:test";
import { SearchFailure } from "./search-failure";

function apiError(status: number, message: string) {
  return Object.assign(new Error(message), { name: "ApiError", status });
}

describe("SearchFailure.classify", () => {
  test.each([
    [apiError(403, "Application is blocked"), "backend_blocked"],
    [apiError(429, "Operations quota exceeded"), "backend_blocked"],
    [
      new Error("Search failed", {
        cause: apiError(403, "Application is blocked"),
      }),
      "backend_blocked",
    ],
    [
      Object.assign(new Error("tagged"), { _tag: "SearchBackendBlocked" }),
      "backend_blocked",
    ],
    [apiError(429, "Too Many Requests"), "unexpected"],
    [apiError(403, "Method not allowed with this API key"), "unexpected"],
    [new Error("Unreachable hosts"), "unexpected"],
    ["not even an error", "unexpected"],
  ] as const)("%p is %s", (error, kind) => {
    expect(SearchFailure.classify(error).kind).toBe(kind);
  });
});
