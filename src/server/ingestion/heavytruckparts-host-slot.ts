import type { Effect } from "effect";
import {
  providerHostSlot,
  withProviderHostSlot,
  type ProviderHostStore,
} from "./provider-host-slot";

export type HeavyTruckPartsHostStore = ProviderHostStore;
export const heavyTruckPartsHostPolicy = {
  key: "heavytruckparts.net",
  label: "HTP",
  leaseMs: 90_000,
  requestMs: 65_000,
  waitMs: 300_000,
  pollMs: 4_000,
  gapMs: 0,
} as const;

/** The caller holds the lease through its completed four-second gap. FIFO
 * acquisition prevents a just-released source from overtaking queued sources. */
export function withHeavyTruckPartsHostSlot<A, E, R>(
  store: HeavyTruckPartsHostStore,
  request: Effect.Effect<A, E, R>,
) {
  return withProviderHostSlot(heavyTruckPartsHostPolicy, store, request);
}
export function heavyTruckPartsHostSlot<A, E, R>(
  request: Effect.Effect<A, E, R>,
) {
  return providerHostSlot(heavyTruckPartsHostPolicy, request);
}
