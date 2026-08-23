import { describe, expect, test } from "bun:test";
import { createDiscordNonce } from "./discord-idempotency";

describe("Discord idempotency", () => {
  test("creates a stable Discord-compatible nonce", () => {
    const nonce = createDiscordNonce("run-1:search-1:discord");

    expect(nonce).toBe(createDiscordNonce("run-1:search-1:discord"));
    expect(nonce).not.toBe(createDiscordNonce("run-1:search-2:discord"));
    expect(nonce).toHaveLength(25);
    expect(nonce).toMatch(/^[a-f0-9]+$/);
  });
});
