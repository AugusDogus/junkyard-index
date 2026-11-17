import { sharedProviderHostSlot } from "./shared-provider-host";
import { Effect } from "effect";
import { readIPullUPullResponseText } from "./ipullupull-response-text";
import type { ProviderRequestGate } from "./provider-http-client";
import type { VinplusControl } from "./vinplus-parser";
import { VINPLUS_API, VINPLUS_TENANTS } from "./vinplus-configuration";
import { VinplusError } from "./vinplus-error";
const serial = Effect.runSync(Effect.makeSemaphore(1));
export const vinplusRequestGate: ProviderRequestGate = (request) =>
  serial.withPermits(1)(
    request.pipe(Effect.ensuring(Effect.sleep("1600 millis"))),
  );
/** No retries. One lifetime covers headers, bounded UTF-8 body and interruption. */
export function readVinplusControl(
  control: VinplusControl,
  gate: ProviderRequestGate = vinplusRequestGate,
) {
  return gate(
    Effect.suspend(() => {
      const allowed =
        control.url === VINPLUS_API + "/searchVehicleHttp" ||
        control.url === VINPLUS_API + "/api/vehicle-groups" ||
        VINPLUS_TENANTS.some(
          (tenant) =>
            control.url ===
              `https://vinplus.texnrewards.com/parts/${tenant.slug}` ||
            control.url === VINPLUS_API + "/api/yard-info/" + tenant.yardId ||
            control.url ===
              VINPLUS_API +
                "/api/analytics/year-distribution?yard_id=" +
                tenant.yardId,
        );
      if (!allowed)
        return Effect.fail(
          VinplusError.create(
            "request destination",
            "Control is outside the verified public tenant endpoints",
          ),
        );
      const lifetime = new AbortController();
      const deadline = AbortSignal.timeout(20_000);
      let pending: Promise<string> | null = null;
      return Effect.tryPromise({
        try: (interrupted) => {
          pending = document(
            control,
            AbortSignal.any([lifetime.signal, deadline, interrupted]),
          );
          return pending;
        },
        catch: (cause) =>
          VinplusError.create(
            "request/body " + control.url,
            cause instanceof Error ? cause.message : String(cause),
          ),
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
      );
    }),
  ).pipe(
    sharedProviderHostSlot(control.url),
    Effect.mapError((cause) =>
      cause instanceof Error
        ? VinplusError.create("shared host " + control.url, cause.message)
        : cause,
    ),
  );
}

async function document(
  control: VinplusControl,
  signal: AbortSignal,
): Promise<string> {
  const response = await fetch(control.url, {
    method: control.body === null ? "GET" : "POST",
    body: control.body ?? undefined,
    redirect: "manual",
    signal,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (X11; Linux x86_64; rv:157.0) Gecko/20100101 Firefox/157.0",
      Accept: "application/json,text/html;q=0.9,*/*;q=0.8",
      ...(control.body === null ? {} : { "Content-Type": "application/json" }),
    },
  });
  if (
    response.status !== 200 ||
    response.redirected ||
    (response.url && response.url !== control.url) ||
    response.headers.has("content-range") ||
    response.headers
      .get("content-type")
      ?.split(";")[0]
      ?.trim()
      .toLowerCase() !== control.mime
  ) {
    await response.body?.cancel();
    throw new Error(
      `Expected complete HTTP 200 ${control.mime} at ${control.url}; received ${response.status}`,
    );
  }
  return readIPullUPullResponseText(
    response,
    "VinPlus " + control.url,
    signal,
    4 * 1024 * 1024,
  );
}
