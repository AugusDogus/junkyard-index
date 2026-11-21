/** Workflow-safe corruption check. This is not an authentication signature;
 * each provider separately validates its complete traversal and owned scope. */
export function inventoryCheckpointFingerprint(value: unknown): string {
  return inventoryCheckpointJsonFingerprint(JSON.stringify(value));
}

/** FNV-1a over the first UTF-16 unit of each code point, as persisted
 * checkpoints were hashed. The indexed loop skips the low half of each
 * surrogate pair, which keeps hashes identical to a for-of loop at a
 * fraction of the cost on multi-megabyte checkpoints. */
export function inventoryCheckpointJsonFingerprint(json: string): string {
  let hash = 2166136261;
  for (let index = 0; index < json.length; index++) {
    const unit = json.charCodeAt(index);
    hash = Math.imul(hash ^ unit, 16777619);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = json.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) index++;
    }
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
