/** Workflow-safe corruption check. This is not an authentication signature;
 * each provider separately validates its complete traversal and owned scope. */
export function inventoryCheckpointFingerprint(value: unknown): string {
  let hash = 2166136261;
  for (const char of JSON.stringify(value))
    hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(16).padStart(8, "0");
}
