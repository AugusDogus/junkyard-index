import { ingestionValidation } from "./ingestion-validation";
import { Effect } from "effect";
import { fetchHeavyTruckPartsPage } from "./heavytruckparts-client";
import type { ProviderRequestGate } from "./provider-http-client";
import {
  CSTRUCK_CATALOG,
  CSTRUCK_STORE,
  cstruckRangeUrl,
} from "./cstruck-yard-metadata";

export class CstruckProviderError extends Error {
  readonly tag = "CstruckProviderError";
  constructor(
    readonly operation: string,
    cause: unknown,
  ) {
    super(
      `C&S ${operation}: ${cause instanceof Error ? cause.message : String(cause)}. Prior inventory and checkpoint remain preserved. Inspect the source before resuming.`,
      { cause },
    );
  }
}
export const cstruckValidated = <A>(operation: string, run: () => A) =>
  ingestionValidation({
    try: run,
    catch: (cause) => new CstruckProviderError(operation, cause),
  });
const pass: ProviderRequestGate = (request) => request;
export function fetchCstruckPage(
  url: string,
  gate: ProviderRequestGate = pass,
) {
  const suffix = url.startsWith(CSTRUCK_CATALOG)
    ? url.slice(CSTRUCK_CATALOG.length)
    : "";
  const match = /^&year_start=(\d{4})&year_end=(\d{4})$/.exec(suffix);
  const start = Number(match?.[1]),
    end = Number(match?.[2]);
  const allowed =
    url === CSTRUCK_STORE ||
    Array.from({ length: 15 }, (_, index) =>
      cstruckRangeUrl({ page: index + 1 }),
    ).includes(url) ||
    (match !== null &&
      start >= 1970 &&
      start <= end &&
      end <= 2027 &&
      url === cstruckRangeUrl([start, end]));
  if (!allowed)
    return Effect.fail(
      new CstruckProviderError(
        "destination",
        "URL is outside exact supplier/store year controls",
      ),
    );
  return fetchHeavyTruckPartsPage(url, gate, "C&S").pipe(
    Effect.mapError((cause) => new CstruckProviderError(url, cause)),
  );
}
