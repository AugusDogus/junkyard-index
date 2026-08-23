import { createHash } from "node:crypto";

const DISCORD_NONCE_MAX_LENGTH = 25;

export function createDiscordNonce(idempotencyKey: string): string {
  return createHash("sha256")
    .update(idempotencyKey)
    .digest("hex")
    .slice(0, DISCORD_NONCE_MAX_LENGTH);
}
