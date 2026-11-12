import { Data, Effect } from "effect";
import { z } from "zod";
import { Yard } from "~/lib/yard";
import { inventoryHtmlAttribute } from "./inventory-html";
import {
  fetchProviderText,
  type ProviderRequestGate,
} from "./provider-http-client";
import {
  RTP_MAX_YARD_RECORDS,
  RTP_PAGE_SIZE,
  type RtpYardCode,
} from "./rtp-cursor";
import { RTP_ORIGIN, RTP_YARDS } from "./rtp-yard-metadata";

const text = z.string().trim().min(1).max(200);
const coordinate = z
  .string()
  .regex(/^-?\d+(?:\.\d+)?$/)
  .transform(Number);
const LocationSchema = z.object({
  options: z.object({ active: z.boolean() }),
  label: z.object({ long_label: text, short_label: text.nullish() }),
  address: z.object({
    street_address: text,
    city: text,
    state: text,
    zip: text,
    latitude: coordinate,
    longitude: coordinate,
  }),
  contact: z.object({
    phone: text,
    email: z.union([z.literal(""), z.string().email()]),
  }),
  links: z.object({ home: z.string().url(), inventory: z.string().url() }),
  integrations: z.object({
    yardsmart: z.object({ use_yardsmart: z.boolean(), yard_id: text }),
  }),
});
const FieldSchema = z.string().max(200).nullish();
const OptionalFieldSchema = FieldSchema.catch(null);
// Strip internal notes, events and staff identifiers at this boundary.
export const RtpRecordSchema = z.object({
  id: z.string().regex(/^[1-9]\d*$/),
  yard_id: z.string().regex(/^[1-9]\d*$/),
  stock_number: z
    .string()
    .regex(/^\d{12}$/)
    .nullish()
    .catch(null),
  year: FieldSchema,
  make: FieldSchema,
  model: FieldSchema,
  color: OptionalFieldSchema,
  vin: FieldSchema,
  yard_row: OptionalFieldSchema,
  date_set: OptionalFieldSchema,
  active: z.enum(["0", "1"]),
  status: text,
  images: z
    .array(
      z
        .object({ full: z.string().max(2048).nullish().catch(null) })
        .catch({ full: null }),
    )
    .max(100)
    .nullish()
    .catch(null),
});
export type RtpRecord = z.infer<typeof RtpRecordSchema>;
export type RtpYard = Yard & { source: "rtp"; code: RtpYardCode };

export class RtpProviderError extends Data.TaggedError("RtpProviderError")<{
  operation: string;
  cause: unknown;
}> {
  override get message() {
    return `RTP ${this.operation}: ${this.cause instanceof Error ? this.cause.message : String(this.cause)}`;
  }
}

function request(
  url: string,
  operation: string,
  requestGate: ProviderRequestGate,
  body?: string,
) {
  return fetchProviderText({
    url,
    context: `RTP ${operation}`,
    requestGate,
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
        throw new Error("Partial response cannot establish complete inventory");
      if (response.url && response.url !== url)
        throw new Error(
          "Response redirected away from the verified inventory endpoint",
        );
    },
  }).pipe(
    Effect.mapError((cause) => new RtpProviderError({ operation, cause })),
  );
}

export function fetchRtpContext(
  yardCode: RtpYardCode,
  gate: ProviderRequestGate,
) {
  const operation = `yard ${yardCode} public inventory context`;
  return Effect.gen(function* () {
    const expected = RTP_YARDS[yardCode];
    const html = yield* request(`${expected.home}inventory/`, operation, gate);
    return yield* Effect.try({
      try: () => {
        if (
          html.length > 3_000_000 ||
          !/<\/html\s*>\s*(?:<!--[\s\S]*?-->\s*)*$/i.test(html)
        )
          throw new Error("Public inventory HTML is truncated or oversized");
        const assignments = [
          ...html.matchAll(/\$rtp\.o\.theme_options\s*=\s*(\{[\s\S]*?\});/g),
        ];
        const encoded = assignments[0]?.[1];
        if (assignments.length !== 1 || !encoded)
          throw new Error(
            "Public location directory assignment is missing or ambiguous",
          );
        const directory = z
          .object({ locations: z.array(z.unknown()).max(100) })
          .parse(JSON.parse(encoded));
        const locations = directory.locations.flatMap((value) => {
          const identity = z
            .object({
              integrations: z.object({
                yardsmart: z.object({ yard_id: z.string() }),
              }),
            })
            .safeParse(value);
          return identity.success &&
            identity.data.integrations.yardsmart.yard_id === yardCode
            ? [LocationSchema.parse(value)]
            : [];
        });
        const location = locations[0];
        if (
          locations.length !== 1 ||
          !location ||
          !location.options.active ||
          !location.integrations.yardsmart.use_yardsmart ||
          location.address.state !== expected.state ||
          location.links.home !== expected.home ||
          location.links.inventory !== `${expected.home}inventory/`
        )
          throw new Error(
            `Verified yard ${yardCode} is missing, inactive or changed identity; inspect its official location page`,
          );
        const hiddenYards = [...html.matchAll(/<input\b[^>]*>/gi)].flatMap(
          ([tag]) =>
            (inventoryHtmlAttribute(tag, "class") ?? "")
              .split(/\s+/)
              .includes("search-form-yard-id")
              ? [inventoryHtmlAttribute(tag, "value")]
              : [],
        );
        if (!hiddenYards.length || hiddenYards.some((id) => id !== yardCode))
          throw new Error(
            "Inventory form does not agree with the native YardSmart ID",
          );
        const ajax =
          /\$rtp\.o\.ajax\s*=\s*\{([\s\S]*?)\};/.exec(html)?.[1] ?? "";
        const ajaxUrl = /\burl:\s*'([^']+)'/.exec(ajax)?.[1];
        const nonce = /\bnonce:\s*'([A-Za-z0-9]{1,64})'/.exec(ajax)?.[1];
        const actions = /\bactions:\s*(\[[^\]]*\])/.exec(ajax)?.[1];
        if (
          ajaxUrl !== `${RTP_ORIGIN}/wp-admin/admin-ajax.php` ||
          !nonce ||
          !actions ||
          !z.array(z.string()).parse(JSON.parse(actions)).includes("inventory")
        )
          throw new Error(
            "Public inventory AJAX configuration is missing or changed",
          );
        const parsed = Yard.parse({
          source: "rtp",
          code: yardCode,
          operator: location.label.short_label ?? null,
          name: location.label.long_label,
          address: location.address.street_address,
          city: location.address.city,
          state: location.address.state,
          postalCode: location.address.zip,
          lat: location.address.latitude,
          lng: location.address.longitude,
          websiteUrl: location.links.home,
          phone: location.contact.phone,
          email: location.contact.email || null,
        });
        if (
          !parsed.success ||
          Yard.coordinates(parsed.data.lat, parsed.data.lng).lat === null
        )
          throw new Error(
            "Official yard location/contact metadata is incomplete or invalid",
          );
        const yard: RtpYard = { ...parsed.data, source: "rtp", code: yardCode };
        // Public CSRF state stays in memory for this checkpoint, never in a cursor or log.
        return { yard, nonce };
      },
      catch: (cause) => new RtpProviderError({ operation, cause }),
    });
  });
}

export function fetchRtpPage(
  yardCode: RtpYardCode,
  offset: number,
  nonce: string,
  gate: ProviderRequestGate,
) {
  const operation = `yard ${yardCode} inventory offset ${offset}`;
  return Effect.gen(function* () {
    const draw = offset / RTP_PAGE_SIZE + 1;
    const body = new URLSearchParams({
      action: "inventory",
      api_call: "getInventoryDatatablesArray",
      _ajax_nonce: nonce,
      draw: String(draw),
      start: String(offset),
      length: String(RTP_PAGE_SIZE),
      "params[yard_id]": yardCode,
      "params[year]": "false",
      "params[make]": "false",
      "params[model]": "false",
      "params[log]": "false",
      "search[value]": "",
      "search[regex]": "false",
      "order[0][column]": "5",
      "order[0][dir]": "asc",
      "columns[5][data]": "stock_number",
    });
    const raw = yield* request(
      `${RTP_ORIGIN}/wp-admin/admin-ajax.php`,
      operation,
      gate,
      body.toString(),
    );
    return yield* Effect.try({
      try: () => {
        if (raw.length > 2_000_000)
          throw new Error("Inventory page exceeds the 2 MB character bound");
        const total = z.number().int().positive().max(RTP_MAX_YARD_RECORDS);
        const page = z
          .object({
            draw: z.string(),
            recordsTotal: total,
            recordsFiltered: total,
            data: z.array(RtpRecordSchema).max(RTP_PAGE_SIZE),
          })
          .parse(JSON.parse(raw));
        const expected = Math.min(RTP_PAGE_SIZE, page.recordsTotal - offset);
        if (
          page.draw !== String(draw) ||
          page.recordsFiltered !== page.recordsTotal ||
          expected <= 0 ||
          page.data.length !== expected ||
          page.data.some((record) => record.yard_id !== yardCode) ||
          new Set(page.data.map((record) => record.id)).size !==
            page.data.length
        )
          throw new Error(
            "Inventory page has contradictory totals, draw, length, identities or yard; no checkpoint can be accepted",
          );
        return { total: page.recordsTotal, records: page.data };
      },
      catch: (cause) => new RtpProviderError({ operation, cause }),
    });
  });
}
