import { Data, Effect } from "effect";
import { z } from "zod";
import { Yard } from "~/lib/yard";
import {
  fetchProviderText,
  type ProviderRequestGate,
} from "./provider-http-client";
import { parseNvpapPage } from "./nvpap-parser";
import type { NvpapYardCode } from "./nvpap-cursor";
import {
  NVPAP_ORIGIN,
  NVPAP_YARDS,
  nvpapInventoryUrl,
  type NvpapYard,
} from "./nvpap-yard-metadata";

export class NvpapProviderError extends Data.TaggedError("NvpapProviderError")<{
  operation: string;
  cause: unknown;
}> {
  override get message() {
    return (
      "Nevada Pic-A-Part " +
      this.operation +
      ": " +
      (this.cause instanceof Error ? this.cause.message : String(this.cause))
    );
  }
}
function request(
  path: string,
  operation: string,
  gate: ProviderRequestGate,
  body?: string,
) {
  const url = NVPAP_ORIGIN + path;
  return fetchProviderText({
    url,
    context: "Nevada Pic-A-Part " + operation,
    requestGate: gate,
    body,
    method: body === undefined ? "GET" : "POST",
    headers: {
      "User-Agent": "JunkyardIndex/1.0",
      ...(body === undefined
        ? {}
        : {
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          }),
    },
    retry: {
      timeoutMs: 20_000,
      retryLimit: 2,
      retryNetworkErrors: false,
      jitter: false,
    },
    onResponse: (response) => {
      if (response.status === 206 || response.headers.has("content-range"))
        throw new Error(
          "Partial response cannot establish complete Nevada inventory",
        );
      if (response.url && response.url !== url)
        throw new Error(
          "Nevada inventory redirected away from its verified endpoint",
        );
    },
  }).pipe(
    Effect.mapError((cause) => new NvpapProviderError({ operation, cause })),
  );
}

const address = z.object({
  streetAddress: z.string(),
  addressLocality: z.string(),
  addressRegion: z.literal("NV"),
  postalCode: z.string(),
  addressCountry: z.literal("US"),
});
const contact = z.object({
  department: z.array(z.object({ telephone: z.string(), address })).length(2),
});
export function fetchNvpapYards(gate: ProviderRequestGate) {
  const operation = "official yard contact metadata";
  return Effect.gen(function* () {
    const html = yield* request("/contact.html", operation, gate);
    return yield* Effect.try({
      try: () => {
        if (html.length > 500_000 || !/<\/html>\s*$/i.test(html))
          throw new Error("Official contact page is oversized or truncated");
        const scripts = [
          ...html.matchAll(
            /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g,
          ),
        ];
        const script = scripts[0]?.[1];
        if (scripts.length !== 1 || !script)
          throw new Error("Official contact directory is missing or ambiguous");
        const directory = contact.parse(JSON.parse(script));
        return (["1074", "1075"] as const).map((code): NvpapYard => {
          const expected = NVPAP_YARDS[code];
          const matches = directory.department.filter(
            (d) => d.address.streetAddress === expected.address,
          );
          const entry = matches[0];
          if (
            matches.length !== 1 ||
            !entry ||
            entry.address.addressLocality !== expected.city ||
            entry.address.postalCode !== expected.postalCode ||
            entry.telephone !== expected.phone
          )
            throw new Error(
              "Verified Nevada yard " +
                code +
                " changed contact identity; inspect the official page before retrying",
            );
          const parsed = Yard.parse({
            source: "nvpap",
            code,
            name: expected.name,
            operator: "Nevada Pic-A-Part",
            address: entry.address.streetAddress,
            city: entry.address.addressLocality,
            state: "NV",
            postalCode: entry.address.postalCode,
            lat: expected.lat,
            lng: expected.lng,
            websiteUrl: nvpapInventoryUrl(code),
            phone: entry.telephone,
            email: "info@nvpap.com",
          });
          if (!parsed.success)
            throw new Error(
              "Verified Nevada yard metadata is invalid: " +
                parsed.error.message,
            );
          return { ...parsed.data, source: "nvpap", code };
        });
      },
      catch: (cause) => new NvpapProviderError({ operation, cause }),
    });
  });
}

export function fetchNvpapPage(
  code: NvpapYardCode,
  year: number,
  gate: ProviderRequestGate,
) {
  const operation = "yard " + code + " year " + year;
  return Effect.gen(function* () {
    const raw = yield* request(
      "/wp-json/pt1/v1/vehicle-stock",
      operation,
      gate,
      new URLSearchParams({
        makes: "0",
        models: "0",
        years: String(year),
        beginDate: "",
        store: code,
      }).toString(),
    );
    return yield* Effect.try({
      try: () => parseNvpapPage(raw, code, year),
      catch: (cause) => new NvpapProviderError({ operation, cause }),
    });
  });
}
