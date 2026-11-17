import { ingestionValidation } from "./ingestion-validation";
import { Data, Effect } from "effect";
import { DonorPhoto } from "./donor-photo";
import type { DonorPhotoStore } from "./donor-photo-store";
import { readIPullUPullResponseText } from "./ipullupull-response-text";
import {
  parseUtpapMakes,
  parseUtpapMakePage,
  parseUtpapXml,
} from "./utpap-parser";
import {
  fetchProviderResponse,
  type ProviderRequestGate,
} from "./provider-http-client";
import {
  UTPAP_ORIGIN,
  parseUtpapYard,
  utpapMakePath,
  utpapYardSlug,
  type UtpapYardCode,
} from "./utpap-yard-metadata";

export class UtpapProviderError extends Data.TaggedError("UtpapProviderError")<{
  operation: string;
  cause: unknown;
}> {
  override get message() {
    return (
      "Utah Pic-A-Part " +
      this.operation +
      ": " +
      (this.cause instanceof Error ? this.cause.message : String(this.cause)) +
      ". No advanced checkpoint accepted; retain previous inventory and inspect the native source before retrying."
    );
  }
}
function text(path: string, kind: "html" | "xml", gate: ProviderRequestGate) {
  const url = UTPAP_ORIGIN + path;
  return Effect.gen(function* () {
    const response = yield* fetchProviderResponse({
      url,
      context: "Utah Pic-A-Part " + path,
      requestGate: gate,
      retry: { timeoutMs: 20_000, retryLimit: 0, retryNetworkErrors: false },
      onResponse: (r) => {
        if (
          r.status !== 200 ||
          r.headers.has("content-range") ||
          (r.url && r.url !== url)
        )
          throw new Error(
            "Expected complete HTTP 200 from the verified Utah endpoint, received " +
              r.status,
          );
      },
    });
    const mime = response.headers
      .get("content-type")
      ?.split(";")[0]
      ?.trim()
      .toLowerCase();
    if (mime !== (kind === "html" ? "text/html" : "text/xml"))
      return yield* Effect.fail(
        new Error("Unexpected Utah content type " + mime),
      );
    return yield* Effect.tryPromise({
      try: () =>
        readIPullUPullResponseText(
          response,
          "Utah " + path,
          AbortSignal.timeout(20_000),
        ),
      catch: (cause) => cause,
    });
  }).pipe(
    Effect.mapError(
      (cause) => new UtpapProviderError({ operation: path, cause }),
    ),
  );
}
export function fetchUtpapStart(
  code: UtpapYardCode,
  gate: ProviderRequestGate,
) {
  const slug = utpapYardSlug(code);
  const premiumName = code === "1064" ? "Ogden" : "Orem";
  return Effect.gen(function* () {
    const inventory = yield* text("/" + slug + "-inventory/", "html", gate);
    const premium = yield* text(
      "/" + slug + "-premium-inventory/",
      "html",
      gate,
    );
    const premiumPath = "/invupdPremium" + premiumName + ".html";
    const script = yield* text(premiumPath, "html", gate);
    const xmlPath = "/" + code + "_inventory.xml";
    const xml = yield* text(xmlPath, "xml", gate);
    const directory = yield* text(utpapMakePath(code), "html", gate);
    return yield* ingestionValidation({
      try: () => {
        const yard = parseUtpapYard(inventory, code);
        if (
          !inventory.includes(UTPAP_ORIGIN + utpapMakePath(code)) ||
          !premium.includes(UTPAP_ORIGIN + premiumPath) ||
          !script.includes("fetch('" + xmlPath.slice(1) + "')")
        )
          throw new Error(
            "Utah official inventory no longer publishes the verified PHP/XML paths",
          );
        const records = parseUtpapXml(xml, code);
        const makes = parseUtpapMakes(directory).sort();
        if (
          JSON.stringify(makes) !==
          JSON.stringify([...new Set(records.map((r) => r.MAKE))].sort())
        )
          throw new Error("Utah XML and native make directory disagree");
        return { yard, records, makes };
      },
      catch: (cause) =>
        new UtpapProviderError({
          operation: "yard " + code + " complete feed discovery",
          cause,
        }),
    });
  });
}
export function fetchUtpapMake(
  code: UtpapYardCode,
  make: string,
  gate: ProviderRequestGate,
) {
  return text(utpapMakePath(code, make), "html", gate).pipe(
    Effect.flatMap((raw) =>
      ingestionValidation({
        try: () => parseUtpapMakePage(raw, code, make),
        catch: (cause) =>
          new UtpapProviderError({
            operation: "yard " + code + " make " + make,
            cause,
          }),
      }),
    ),
  );
}

export function preserveUtpapPhoto(
  raw: string,
  store: DonorPhotoStore,
  gate: ProviderRequestGate,
) {
  return gate(
    Effect.tryPromise({
      try: async (signal) => {
        const url = URL.parse(raw);
        if (
          !url ||
          url.origin !== UTPAP_ORIGIN ||
          url.username ||
          url.password ||
          url.search ||
          url.hash ||
          !/^\/(?:Ogden|Orem)-inventory-photos\/[AK]\d{6}\.jpeg$/.test(
            url.pathname,
          )
        )
          throw new Error(
            "Utah photo is not a published stock-specific donor image",
          );
        const response = await fetch(url.href, {
          redirect: "manual",
          signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
          headers: { "User-Agent": "JunkyardIndex/1.0", Accept: "image/jpeg" },
        });
        if (response.status !== 200) {
          await response.body?.cancel();
          throw new Error(
            "Provided Utah donor photo requires HTTP 200; received HTTP " +
              response.status,
          );
        }
        const photo = await DonorPhoto.read(response);
        const hash = await store.save(photo.bytes);
        if (hash !== photo.hash)
          throw new Error("Utah preserved photo differs from the source bytes");
        return { status: "preserved" as const, hash };
      },
      catch: (cause) =>
        new UtpapProviderError({ operation: "preserve donor photo", cause }),
    }),
  );
}
