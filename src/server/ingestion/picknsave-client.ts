import { Data, Effect } from "effect";
import { z } from "zod";
import {
  fetchProviderText,
  type ProviderRequestGate,
} from "./provider-http-client";
import {
  PICKNSAVE_MAX_PRODUCTS,
  PICKNSAVE_PAGE_SIZE,
} from "./picknsave-cursor";

export const PICKNSAVE_ORIGIN = "https://pick-n-save.net";
const ProductSchema = z.object({
  id: z.number().int().positive().safe(),
  date: z.string().nullish(),
  status: z.literal("publish"),
  type: z.literal("product"),
  link: z.string().url(),
});
export type PickNSaveProduct = z.infer<typeof ProductSchema>;

export class PickNSaveProviderError extends Data.TaggedError(
  "PickNSaveProviderError",
)<{
  operation: string;
  cause: unknown;
}> {
  override get message() {
    return `Pick-n-Save ${this.operation}: ${this.cause instanceof Error ? this.cause.message : String(this.cause)}`;
  }
}

export function pickNSaveDetailUrl(raw: string): string {
  const url = new URL(raw);
  if (
    url.origin !== PICKNSAVE_ORIGIN ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !/^\/vehicles\/[a-z0-9-]+\/$/.test(url.pathname)
  )
    throw new Error(
      "Unverified vehicle detail URL; inspect the public product listing before retrying",
    );
  return url.href;
}

function request(
  url: string,
  operation: string,
  requestGate: ProviderRequestGate,
  onResponse?: (response: Response) => void,
) {
  return fetchProviderText({
    url,
    context: `Pick-n-Save ${operation}`,
    requestGate,
    headers: { "User-Agent": "JunkyardIndex/1.0" },
    retry: {
      timeoutMs: 20_000,
      retryLimit: 2,
      retryNetworkErrors: false,
      jitter: false,
    },
    onResponse: (response) => {
      if (response.status === 206 || response.headers.has("content-range"))
        throw new Error(
          "Partial response; no complete inventory checkpoint can be accepted",
        );
      if (response.url && response.url !== url)
        throw new Error(
          "Request redirected away from the verified inventory URL",
        );
      if (response.ok) onResponse?.(response);
    },
  }).pipe(
    Effect.mapError(
      (cause) => new PickNSaveProviderError({ operation, cause }),
    ),
  );
}

export function fetchPickNSavePage(
  page: number,
  requestGate: ProviderRequestGate,
) {
  const operation = `catalog page ${page}`;
  return Effect.gen(function* () {
    if (
      !Number.isSafeInteger(page) ||
      page < 1 ||
      page > PICKNSAVE_MAX_PRODUCTS / PICKNSAVE_PAGE_SIZE
    )
      return yield* new PickNSaveProviderError({
        operation,
        cause: new Error("Page is outside the verified catalog bounds"),
      });
    const url = new URL("/wp-json/wp/v2/product", PICKNSAVE_ORIGIN);
    url.search = new URLSearchParams({
      per_page: String(PICKNSAVE_PAGE_SIZE),
      page: String(page),
      orderby: "id",
      order: "asc",
      status: "publish",
    }).toString();
    let pagination: { totalProducts: number; totalPages: number } | undefined;
    const html = yield* request(
      url.href,
      operation,
      requestGate,
      (response) => {
        if (
          !(response.headers.get("content-type") ?? "").includes(
            "application/json",
          )
        )
          throw new Error("Catalog response is not JSON");
        const total = response.headers.get("x-wp-total") ?? "";
        const pages = response.headers.get("x-wp-totalpages") ?? "";
        if (
          !/^[1-9]\d*$/.test(total) ||
          !/^[1-9]\d*$/.test(pages) ||
          Number(total) > PICKNSAVE_MAX_PRODUCTS ||
          Number(pages) !== Math.ceil(Number(total) / PICKNSAVE_PAGE_SIZE)
        )
          throw new Error(
            "Missing, contradictory, or oversized WordPress pagination totals",
          );
        pagination = {
          totalProducts: Number(total),
          totalPages: Number(pages),
        };
      },
    );
    return yield* Effect.try({
      try: () => {
        if (!pagination || html.length > 2_000_000)
          throw new Error(
            "Missing pagination evidence or catalog exceeds the 2 MB character bound",
          );
        const products = z
          .array(ProductSchema)
          .max(PICKNSAVE_PAGE_SIZE)
          .parse(JSON.parse(html));
        const expected = Math.min(
          PICKNSAVE_PAGE_SIZE,
          pagination.totalProducts - (page - 1) * PICKNSAVE_PAGE_SIZE,
        );
        if (products.length !== expected || expected <= 0)
          throw new Error(
            `Received ${products.length} products, expected ${expected}; catalog is truncated or page was ignored`,
          );
        for (const product of products) pickNSaveDetailUrl(product.link);
        return { ...pagination, products };
      },
      catch: (cause) => new PickNSaveProviderError({ operation, cause }),
    });
  });
}

export function fetchPickNSaveDetail(
  product: PickNSaveProduct,
  requestGate: ProviderRequestGate,
) {
  const operation = `vehicle ${product.id}`;
  return Effect.try({
    try: () => pickNSaveDetailUrl(product.link),
    catch: (cause) => new PickNSaveProviderError({ operation, cause }),
  }).pipe(
    Effect.flatMap((url) =>
      request(url, operation, requestGate, (response) => {
        if (!(response.headers.get("content-type") ?? "").includes("text/html"))
          throw new Error("Vehicle response is not HTML");
      }),
    ),
  );
}
