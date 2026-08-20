import { Effect, Schema } from "effect";
import {
  fetchProviderJson,
  type ProviderRequestGate,
} from "./provider-http-client";

export const GOPULLIT_ORIGIN = "https://gopullit.com";

export interface GopullitSession {
  // Cloudflare issues this public, short-lived session cookie on the first page.
  cloudflareCookie: string | null;
}

export const GopullitSession = {
  make: (): GopullitSession => ({ cloudflareCookie: null }),
} as const;

const GopullitGalleryImageSchema = Schema.Struct({
  thumbnail: Schema.optional(Schema.NullOr(Schema.String)),
  full: Schema.optional(Schema.NullOr(Schema.String)),
});

export const GopullitInventoryRecordSchema = Schema.Struct({
  id: Schema.Number,
  title: Schema.String,
  created_at: Schema.String,
  gallery: Schema.optional(Schema.Array(GopullitGalleryImageSchema)),
  location: Schema.optional(Schema.NullOr(Schema.String)),
  make: Schema.optional(Schema.NullOr(Schema.String)),
  model: Schema.optional(Schema.NullOr(Schema.String)),
  vin: Schema.optional(Schema.NullOr(Schema.String)),
  yardCity: Schema.optional(Schema.NullOr(Schema.String)),
  yardDate: Schema.optional(Schema.NullOr(Schema.String)),
  yardState: Schema.optional(Schema.NullOr(Schema.String)),
  year: Schema.optional(Schema.NullOr(Schema.String)),
});

export type GopullitInventoryRecord = Schema.Schema.Type<
  typeof GopullitInventoryRecordSchema
>;

export const GopullitInventoryPageSchema = Schema.Array(
  GopullitInventoryRecordSchema,
);

export type GopullitInventoryPage = Schema.Schema.Type<
  typeof GopullitInventoryPageSchema
>;

export function fetchGopullitPage(
  page: number,
  requestGate?: ProviderRequestGate,
  session?: GopullitSession,
): Effect.Effect<GopullitInventoryPage, Error> {
  const url = new URL("/wp-json/apppresser/v1/inventory", GOPULLIT_ORIGIN);
  url.searchParams.set("page", String(page));

  return fetchProviderJson({
    url: url.toString(),
    context: `GO Pull-It inventory page ${page}`,
    schema: GopullitInventoryPageSchema,
    headers: () => ({
      Referer: `${GOPULLIT_ORIGIN}/inventory/`,
      ...(session?.cloudflareCookie
        ? { Cookie: session.cloudflareCookie }
        : {}),
    }),
    requestGate,
    onResponse: (response) => {
      const setCookie = response.headers.get("set-cookie") ?? "";
      const match = /(?:^|[,\s])(__cf_bm=[^;]+)/.exec(setCookie);
      if (session && match?.[1]) session.cloudflareCookie = match[1];
    },
  });
}
