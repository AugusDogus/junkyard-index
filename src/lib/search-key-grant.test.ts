import { describe, expect, test } from "bun:test";
import { SearchKeyGrant } from "./search-key-grant";

function apiError(status: number, message: string) {
  return Object.assign(new Error(message), { name: "ApiError", status });
}

describe("SearchKeyGrant.isKeyRejection", () => {
  test.each([
    // A refused key: fetch another one and retry.
    [apiError(403, "Invalid Application-ID or API key"), true],
    [apiError(403, "The validity of the API key has expired"), true],
    [apiError(403, "Method not allowed with this API key"), true],
    // The app is blocked or over quota: a new key cannot help.
    [apiError(403, "Application is blocked"), false],
    [apiError(403, "Search operations quota exceeded"), false],
    [apiError(429, "Operations quota exceeded"), false],
    // Not about the key at all.
    [apiError(429, "Too Many Requests"), false],
    [apiError(400, "Invalid search parameters"), false],
    [apiError(500, "Internal error"), false],
    [new Error("Unreachable hosts"), false],
  ] as const)("%p is a key rejection: %p", (error, rejected) => {
    expect(SearchKeyGrant.isKeyRejection(error)).toBe(rejected);
  });
});
