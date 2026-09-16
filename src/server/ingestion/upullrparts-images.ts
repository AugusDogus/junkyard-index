import { Effect, Schema } from "effect";
import { fetchProviderJson } from "./provider-http-client";
import { hasHttpPaginationLink } from "./provider-http-pagination";
import {
  UPULLRPARTS_API_URL,
  UpullRPartsProviderError,
} from "./upullrparts-client";

// The public inventory UI loads visible stock thumbnails concurrently. Keep
// this independent of the serial catalog/make gate and inside its checkpoint.
export const UPULLRPARTS_IMAGE_CONCURRENCY = 8;
const photoOrder = [6, 3, 4, 1, 5, 2];

function photoRank(fileName: string): number {
  const index = /_(\d+)_/.exec(fileName)?.[1];
  const rank = photoOrder.indexOf(Number(index));
  return rank < 0 ? photoOrder.length : rank;
}

export function fetchUpullRPartsImage(stock: string) {
  const image = Schema.Struct({
    fileName: Schema.String,
    url: Schema.String,
  }).pipe(
    Schema.filter(
      ({ fileName, url }) =>
        fileName.startsWith(`${stock}_`) &&
        /^[\w.-]+\.jpg$/i.test(fileName) &&
        url === `https://api.aaaparts.com/staticImages/${fileName}`,
    ),
  );
  return fetchProviderJson({
    url: UPULLRPARTS_API_URL,
    context: `U Pull R Parts getVehicleImages stock ${stock}`,
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "JunkyardIndex/1.0",
    },
    body: new URLSearchParams({
      action: "doAaaApiCall",
      apiAction: "getVehicleImages",
      stockID: stock,
    }).toString(),
    schema: Schema.Struct({
      success: Schema.Literal(1),
      images: Schema.Array(image).pipe(Schema.maxItems(100)),
    }),
    onResponse: (response) => {
      if (
        response.status === 206 ||
        response.headers.has("content-range") ||
        hasHttpPaginationLink(response.headers)
      ) {
        throw new Error(
          `U Pull R Parts getVehicleImages stock ${stock} returned a partial or paginated response. Verify the photo endpoint before retrying from cursor 0; no yard or vehicle batches were emitted.`,
        );
      }
    },
    retry: { retryLimit: 2, retryNetworkErrors: false, jitter: false },
  }).pipe(
    Effect.map(
      ({ images }) =>
        [...images].sort(
          (a, b) => photoRank(a.fileName) - photoRank(b.fileName),
        )[0]?.url ?? null,
    ),
    Effect.mapError((cause) => new UpullRPartsProviderError({ cause })),
  );
}

/** One lookup per distinct stock, including explicit empty photo lists. */
export function loadUpullRPartsImages(stocks: readonly (string | null)[]) {
  return Effect.forEach(
    [...new Set(stocks.filter((stock) => stock !== null))],
    (stock) =>
      fetchUpullRPartsImage(stock).pipe(
        Effect.map((url) => [stock, url] as const),
      ),
    { concurrency: UPULLRPARTS_IMAGE_CONCURRENCY },
  ).pipe(Effect.map((entries) => new Map(entries)));
}
