import { Data, Effect } from "effect";
import { z } from "zod";
import {
  fetchProviderResponse,
  type ProviderRequestGate,
} from "./provider-http-client";
import { readIPullUPullResponseText } from "./ipullupull-response-text";
import {
  PontiacModelSchema,
  PontiacNameSchema,
  PontiacYearSchema,
  pontiacSearchPath,
  type PontiacQuery,
} from "./pontiac-catalog";
import {
  PontiacControlSchema,
  PontiacDetailSchema,
  PontiacSearchSchema,
} from "./pontiac-record";
import { parsePontiacContact, PONTIAC_ORIGIN } from "./pontiac-yard-metadata";

export class PontiacProviderError extends Data.TaggedError(
  "PontiacProviderError",
)<{
  operation: string;
  cause: unknown;
}> {
  override get message() {
    return (
      "Pontiac " +
      this.operation +
      ": " +
      (this.cause instanceof Error ? this.cause.message : String(this.cause)) +
      ". No advanced checkpoint accepted; retain the previous inventory and retry the last checkpoint after inspecting the response."
    );
  }
}

function request(
  path: string,
  gate: ProviderRequestGate,
  kind: "html" | "json",
  allowMissing = false,
) {
  const url = PONTIAC_ORIGIN + path;
  return Effect.gen(function* () {
    const response = yield* fetchProviderResponse({
      url,
      context: "Pontiac " + path,
      requestGate: gate,
      headers: {
        "User-Agent": "JunkyardIndex/1.0",
        Accept: kind === "json" ? "application/json" : "text/html",
      },
      retry: {
        timeoutMs: 20_000,
        retryLimit: 2,
        retryNetworkErrors: false,
        jitter: false,
      },
      onResponse: (r) => {
        if (r.status === 206 || r.headers.has("content-range"))
          throw new Error(
            "Partial Pontiac response cannot establish completeness",
          );
        if (r.url && r.url !== url)
          throw new Error(
            "Pontiac endpoint redirected away from its verified destination",
          );
      },
    });
    if (response.status === 404 && allowMissing) {
      yield* Effect.promise(async () => {
        await response.body?.cancel();
      });
      return null;
    }
    if (!response.ok)
      return yield* Effect.fail(new Error("HTTP " + response.status));
    const mime = response.headers
      .get("content-type")
      ?.split(";")[0]
      ?.trim()
      .toLowerCase();
    if (mime !== (kind === "json" ? "application/json" : "text/html"))
      return yield* Effect.fail(
        new Error("Unexpected Pontiac content type " + mime),
      );
    return yield* Effect.tryPromise({
      try: () =>
        readIPullUPullResponseText(
          response,
          "Pontiac " + path,
          AbortSignal.timeout(20_000),
        ),
      catch: (cause) =>
        new Error("Unreadable or incomplete Pontiac body: " + String(cause)),
    });
  }).pipe(
    Effect.mapError(
      (cause) => new PontiacProviderError({ operation: path, cause }),
    ),
  );
}

function json<T>(
  path: string,
  schema: z.ZodType<T>,
  gate: ProviderRequestGate,
) {
  return Effect.gen(function* () {
    const text = yield* request(path, gate, "json");
    return yield* Effect.try({
      try: () => schema.parse(JSON.parse(text ?? "")),
      catch: (cause) => new PontiacProviderError({ operation: path, cause }),
    });
  });
}

function distinct<T>(
  schema: z.ZodType<T>,
  cap: number,
  key: (entry: T) => string | number,
) {
  return z
    .array(schema)
    .max(cap - 1)
    .refine(
      (rows) => new Set(rows.map(key)).size === rows.length,
      "Repeated Pontiac directory or donor identity",
    );
}

export function fetchPontiacYard(gate: ProviderRequestGate) {
  return request("/used-car-parts-pontiac", gate, "html").pipe(
    Effect.flatMap((html) =>
      Effect.try({
        try: () => parsePontiacContact(html ?? ""),
        catch: (cause) =>
          new PontiacProviderError({
            operation: "official yard metadata",
            cause,
          }),
      }),
    ),
  );
}
export const fetchPontiacControls = (gate: ProviderRequestGate) =>
  json(
    "/api/vehicles/recent/105",
    distinct(PontiacControlSchema, 100, (c) => c.vehicleID).refine(
      (rows) => rows.length > 0,
      "Missing positive controls",
    ),
    gate,
  );
export const fetchPontiacYears = (gate: ProviderRequestGate) =>
  json(
    "/api/vehicles/years",
    distinct(
      z.object({ modelYear: PontiacYearSchema }),
      150,
      (y) => y.modelYear,
    ).refine((rows) => rows.length > 0, "Missing native years"),
    gate,
  );
export const fetchPontiacMakes = (year: number, gate: ProviderRequestGate) =>
  json(
    "/api/vehicles/make/" + year,
    distinct(
      z.object({ vehicleMake: PontiacNameSchema }),
      150,
      (m) => m.vehicleMake,
    ),
    gate,
  );
export const fetchPontiacModels = (
  year: number,
  make: string,
  gate: ProviderRequestGate,
) =>
  json(
    "/api/vehicles/model/" + year + "/" + encodeURIComponent(make),
    distinct(PontiacModelSchema, 300, (m) =>
      JSON.stringify([m.hollanderModel, m.trueModel, m.mmdCD, m.mmdCategory]),
    ),
    gate,
  );
export const fetchPontiacSearch = (
  query: PontiacQuery,
  gate: ProviderRequestGate,
) =>
  json(
    pontiacSearchPath(query),
    distinct(PontiacSearchSchema, 100, (d) => d.vehicleID),
    gate,
  );
export function fetchPontiacDetail(id: number, gate: ProviderRequestGate) {
  const path = "/api/vehicles/" + id;
  return request(path, gate, "json", true).pipe(
    Effect.flatMap((text) =>
      text === null
        ? Effect.succeed(null)
        : Effect.try({
            try: () => PontiacDetailSchema.parse(JSON.parse(text)),
            catch: (cause) =>
              new PontiacProviderError({ operation: path, cause }),
          }),
    ),
  );
}
