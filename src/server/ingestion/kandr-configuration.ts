import type { KandrContract } from "./kandr-contract";

// Complete November 15, 2026 census: 48 accepted donors among 49 native entries.
export const KANDR_CONTRACT = {
  minimumUniqueInventory: 16,
} as const satisfies KandrContract;
