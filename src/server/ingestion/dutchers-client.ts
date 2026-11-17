import { ingestionValidation } from "./ingestion-validation";
import { Data, Effect } from "effect";
import { fetchHeavyTruckPartsPage } from "./heavytruckparts-client";
import { type ProviderRequestGate } from "./provider-http-client";
import {
  DUTCHERS_MAX_PAGES,
  DUTCHERS_SCOPE,
  DUTCHERS_STORE,
  dutchersCatalogUrl,
} from "./dutchers-yard-metadata";

export class DutchersProviderError extends Data.TaggedError(
  "DutchersProviderError",
)<{ operation: string; cause: unknown }> {
  override get message() {
    const detail =
      this.cause instanceof Error ? this.cause.message : String(this.cause);
    return `Dutcher ${this.operation}: ${detail}. Previous inventory and checkpoint remain preserved. Inspect the source before another request.`;
  }
}
export const dutchersValidated = <A>(operation: string, run: () => A) =>
  ingestionValidation({
    try: run,
    catch: (cause) => new DutchersProviderError({ operation, cause }),
  });
const allowed = new Set([
  DUTCHERS_SCOPE,
  DUTCHERS_STORE,
  ...(["DESC", "ASC"] as const).flatMap((d) =>
    Array.from({ length: DUTCHERS_MAX_PAGES }, (_, i) =>
      dutchersCatalogUrl(d, i + 1),
    ),
  ),
]);
export function fetchDutchersPage(url: string, gate: ProviderRequestGate) {
  if (!allowed.has(url))
    return Effect.fail(
      new DutchersProviderError({
        operation: url,
        cause: "URL is outside the exact Dutcher owner/store controls",
      }),
    );
  return fetchHeavyTruckPartsPage(url, gate, "Dutcher").pipe(
    Effect.mapError(
      (cause) => new DutchersProviderError({ operation: url, cause }),
    ),
  );
}
