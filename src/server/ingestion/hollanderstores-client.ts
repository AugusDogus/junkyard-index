import { Data, Effect, Schedule } from "effect";
import { z } from "zod";
import type { ProviderRequestGate } from "./provider-http-client";
import { readBoundedResponseText } from "./ipullupull-response-text";
import {
  hollanderstoresUsesPaging,
  type HollanderstoresYard,
} from "./hollanderstores-yard-metadata";
import { hollanderstoresVin } from "./hollanderstores-vin";
import { HOLLANDERSTORES_MAX_BODY_BYTES } from "./hollanderstores-limits";
import seed from "./hollanderstores-vpic-seed.json";

// Previously verified NHTSA batch responses, November 15, 2026. The seed also
// lets us report known native-make conflicts without decoding populated rows.
export const hollanderstoresSeed: Readonly<Record<string, string>> = seed;
export class HollanderstoresProviderError extends Data.TaggedError(
  "HollanderstoresProviderError",
)<{ operation: string; cause: unknown }> {
  override get message() {
    return `Hollander Stores ${this.operation}: ${this.cause instanceof Error ? this.cause.message : String(this.cause)}. Previous inventory and the last validated checkpoint are preserved. Inspect the response before resuming.`;
  }
}
const serial = Effect.runSync(Effect.makeSemaphore(1));
export const hollanderstoresRequestGate: ProviderRequestGate = (request) =>
  serial.withPermits(1)(
    request.pipe(Effect.ensuring(Effect.sleep("3 seconds"))),
  );
export function hollanderstoresAttempt<A>(operation: string, run: () => A) {
  return Effect.try({
    try: run,
    catch: (cause) => new HollanderstoresProviderError({ operation, cause }),
  });
}
function request(
  url: string,
  body: URLSearchParams,
  mime: string,
  gate: ProviderRequestGate,
) {
  const attempt = Effect.suspend(() => {
    const lifetime = new AbortController();
    const timeoutMs = mime === "text/html" ? 300_000 : 120_000;
    const deadline = AbortSignal.timeout(timeoutMs);
    let pending: Promise<string> | null = null;
    return Effect.tryPromise({
      try: (interrupted) => {
        const signal = AbortSignal.any([
          interrupted,
          lifetime.signal,
          deadline,
        ]);
        pending = (async () => {
          const response = await fetch(url, {
            method: "POST",
            body,
            redirect: "manual",
            signal,
            headers: {
              "User-Agent":
                "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
              Accept: mime,
              "Accept-Language": "en-US,en;q=0.9",
              "Content-Type": "application/x-www-form-urlencoded",
            },
          });
          if (
            response.status !== 200 ||
            response.redirected ||
            (response.url && response.url !== url) ||
            response.headers.has("content-range") ||
            response.headers
              .get("content-type")
              ?.split(";")[0]
              ?.trim()
              .toLowerCase() !== mime
          ) {
            await response.body?.cancel();
            throw new Error(
              `Expected complete HTTP 200 ${mime}; received ${response.status}`,
            );
          }
          return await readBoundedResponseText(
            response,
            "Hollander Stores " + url,
            signal,
            mime === "text/html"
              ? HOLLANDERSTORES_MAX_BODY_BYTES
              : 4 * 1024 * 1024,
          );
        })();
        return pending;
      },
      catch: (cause) =>
        new HollanderstoresProviderError({ operation: url, cause }),
    }).pipe(
      Effect.ensuring(
        Effect.promise(async () => {
          lifetime.abort();
          if (pending)
            await pending.then(
              () => undefined,
              () => undefined,
            );
        }),
      ),
      Effect.timeoutFail({
        duration: `${timeoutMs} millis`,
        onTimeout: () =>
          new HollanderstoresProviderError({
            operation: url,
            cause: `Combined transport/body deadline exceeded ${timeoutMs / 1000} seconds`,
          }),
      }),
    );
  });
  return gate(attempt).pipe(
    Effect.retry(
      Schedule.intersect(Schedule.recurs(2), Schedule.spaced("20 seconds")),
    ),
  );
}
export function fetchHollanderstoresPage(
  yard: HollanderstoresYard,
  gate = hollanderstoresRequestGate,
  pageNumber = 1,
) {
  return request(
    yard.websiteUrl +
      "VehicleDealerSearch" +
      (hollanderstoresUsesPaging(yard) ? `?page=${pageNumber}` : ""),
    new URLSearchParams({
      hdnChangeDisplay: hollanderstoresUsesPaging(yard) ? "list" : "card",
    }),
    "text/html",
    gate,
  );
}
export const HOLLANDERSTORES_VPIC_URL =
  "https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVINValuesBatch/";
const responseSchema = z.object({
  Count: z.number().int(),
  Results: z
    .array(
      z.object({
        VIN: z.string(),
        Make: z.string().nullable(),
        ErrorCode: z.string(),
      }),
    )
    .max(50),
});
export function decodeHollanderstoresBatch(
  vins: readonly string[],
  gate = hollanderstoresRequestGate,
) {
  return Effect.gen(function* () {
    yield* hollanderstoresAttempt("VIN batch inputs", () => {
      if (
        !vins.length ||
        vins.length > 50 ||
        new Set(vins).size !== vins.length ||
        vins.some((vin) => hollanderstoresVin(vin) !== vin)
      )
        throw new Error("vPIC requires 1-50 unique check-digit-valid VINs");
    });
    const raw = yield* request(
      HOLLANDERSTORES_VPIC_URL,
      new URLSearchParams({ format: "json", data: vins.join(";") }),
      "application/json",
      gate,
    );
    return yield* hollanderstoresAttempt("VIN batch response", () => {
      const response = responseSchema.parse(JSON.parse(raw));
      if (
        response.Count !== vins.length ||
        response.Results.length !== vins.length ||
        new Set(response.Results.map((row) => row.VIN)).size !== vins.length ||
        response.Results.some((row) => !vins.includes(row.VIN))
      )
        throw new Error("vPIC returned missing, duplicate or foreign VINs");
      return Object.fromEntries(
        vins.map((vin) => {
          const row = response.Results.find((row) => row.VIN === vin);
          const make = row?.Make?.trim();
          // A partial decode may still publish a valid make. Never use an empty or placeholder value.
          return [
            vin,
            make && !/^(?:unknown|none|other|n\/?a|null|0+)$/i.test(make)
              ? make
              : null,
          ];
        }),
      );
    });
  });
}
