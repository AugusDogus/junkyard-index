import { describe, expect, test } from "bun:test";
import { HeavytruckpartsCursor } from "./heavytruckparts-cursor";
import { HollanderstoresCursor } from "./hollanderstores-cursor";
import {
  inventoryCheckpointFingerprint,
  inventoryCheckpointJsonFingerprint,
} from "./inventory-checkpoint-fingerprint";

// The code-point loop persisted checkpoints were hashed with.
function codePointFingerprint(json: string): string {
  let hash = 2166136261;
  for (const char of json)
    hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(16).padStart(8, "0");
}

describe("inventory checkpoint fingerprint", () => {
  test("keeps the hashes persisted checkpoints were written with", () => {
    expect(
      inventoryCheckpointFingerprint({
        source: "budget",
        pages: [1, 2, 3],
        vin: "1HGCM82633A004352",
      }),
    ).toBe("e73c1a9f");
    expect(
      inventoryCheckpointFingerprint({
        make: "Citroën 🚗",
        note: "𝒜 and é",
        lone: "\ud800x\udc00",
      }),
    ).toBe("81724db4");
    expect(HollanderstoresCursor.initial().scope).toBe("3548ddf2");
    expect(HollanderstoresCursor.initial().checksum).toBe("8412e6e5");
    // The HTP scope binds the supplier roster, so a roster change moves it.
    expect(HeavytruckpartsCursor.initial().scope).toBe("bd65a259");
    expect(HeavytruckpartsCursor.initial().checksum).toBe("561abaee");
  });

  test("matches the code-point loop on surrogate pairs and lone halves", () => {
    for (const json of [
      "",
      "plain ascii",
      "🚗🚙 at both ends 𝒜",
      "\ud800",
      "\udc00",
      "\ud800𐀀",
      "\udc00\ud800",
      "a\ud83d",
    ])
      expect(inventoryCheckpointJsonFingerprint(json)).toBe(
        codePointFingerprint(json),
      );
  });
});
