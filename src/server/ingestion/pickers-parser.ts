import { createHash } from "node:crypto";
import { z } from "zod";
import {
  inventoryHtmlAttribute,
  stripInventoryRawText,
} from "./inventory-html";
import { parseVinplusSearch, type VinplusPair } from "./vinplus-protocol";
import {
  PICKERS_APP_URL,
  PICKERS_LOCATION_ID,
  PICKERS_OPERATOR_ID,
  PICKERS_ORIGIN,
  PICKERS_YARD,
} from "./pickers-yard-metadata";

export const PICKERS_MAX_MAKES = 64;
export const PICKERS_MAX_QUERIES = 512;
export const PICKERS_MAX_NATIVE_STOCKS = 2_000;
export const PICKERS_MAX_STOCKS = 2_500;
export const PICKERS_MAX_OCCURRENCES = 20_000;
export const PICKERS_MAX_REQUESTS = 512;
export const PICKERS_MAX_RESPONSE_BYTES = 32 * 1024 * 1024;
export const PickersStockSchema = z.string().regex(/^STK\d{6}$/);
export const PickersHashSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const PickersPairSchema = z
  .object({
    make: z.string().min(1).max(200),
    model: z.string().min(1).max(200),
  })
  .strict();
export type PickersPair = z.infer<typeof PickersPairSchema>;

/** Compact tagged tuples keep full optional evidence below the cursor cap. */
export const PickersValueSchema = z.union([
  z.tuple([z.literal("absent")]),
  z.tuple([
    z.literal("literal"),
    z.union([
      z.string().max(2_048),
      z.number().finite(),
      z.boolean(),
      z.null(),
      z.array(z.string().max(2_048)).max(8),
    ]),
  ]),
  z.tuple([
    z.literal("unusable"),
    z.enum(["string", "array", "object", "other"]),
    z.enum(["oversized", "nonliteral"]),
    PickersHashSchema,
    z.number().int().nonnegative(),
  ]),
]);
export type PickersValue = z.infer<typeof PickersValueSchema>;

export function pickersStableJson(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") {
    const encoded = JSON.stringify(value);
    if (encoded === undefined)
      throw new Error("Unsupported Pickers hash value");
    return encoded;
  }
  if (Array.isArray(value))
    return (
      "[" +
      value.map((entry: unknown) => pickersStableJson(entry)).join(",") +
      "]"
    );
  const entries: [string, unknown][] = Object.entries(value);
  return (
    "{" +
    entries
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(
        ([key, entry]) => JSON.stringify(key) + ":" + pickersStableJson(entry),
      )
      .join(",") +
    "}"
  );
}
export const pickersHash = (value: unknown): string =>
  createHash("sha256").update(pickersStableJson(value)).digest("hex");
export const pickersBodyHash = (raw: string): string =>
  createHash("sha256").update(raw).digest("hex");
export const pickersPairKey = (pair: VinplusPair): string =>
  JSON.stringify([pair.make, pair.model]);

export function pickersValue(value: unknown): PickersValue {
  if (value === undefined) return ["absent"];
  const parsed = PickersValueSchema.safeParse(["literal", value]);
  if (parsed.success) return parsed.data;
  const encoded = pickersStableJson(value);
  const type =
    typeof value === "string"
      ? "string"
      : Array.isArray(value)
        ? "array"
        : typeof value === "object"
          ? "object"
          : "other";
  const reason =
    (typeof value === "string" && value.length > 2048) ||
    (Array.isArray(value) && value.length > 8)
      ? "oversized"
      : "nonliteral";
  return [
    "unusable",
    type,
    reason,
    pickersBodyHash(encoded),
    Buffer.byteLength(encoded),
  ];
}
export function pickersLiteral(value: PickersValue): unknown {
  return value[0] === "literal" ? value[1] : undefined;
}

export const PickersNativeRowSchema = z
  .object({
    stock: PickersStockSchema,
    provenanceHash: PickersHashSchema,
    makeIndex: z
      .number()
      .int()
      .nonnegative()
      .max(PICKERS_MAX_MAKES - 1),
    ordinal: z
      .number()
      .int()
      .nonnegative()
      .max(PICKERS_MAX_NATIVE_STOCKS - 1),
    year: z.number().int().min(1886).max(2100).nullable(),
    make: z.string().max(200),
    model: z.string().max(200),
    color: PickersValueSchema,
    reference: PickersValueSchema,
    row: PickersValueSchema,
    date: PickersValueSchema,
    image: PickersValueSchema,
  })
  .strict();
export type PickersNativeRow = z.infer<typeof PickersNativeRowSchema>;

const apiFields = {
  vin: PickersValueSchema,
  make: PickersValueSchema,
  model: PickersValueSchema,
  color: PickersValueSchema,
  vehicleRow: PickersValueSchema,
  dateAdded: PickersValueSchema,
  damage_condition: PickersValueSchema,
  daysInYard: PickersValueSchema,
  engine: PickersValueSchema,
  fuel_type: PickersValueSchema,
  imageUrl: PickersValueSchema,
  imageUrls: PickersValueSchema,
  transmission: PickersValueSchema,
  demo_offset_seconds: PickersValueSchema,
};
export const PickersRecordSchema = z
  .object({
    stock: PickersStockSchema,
    year: z.number().int().min(1886).max(2100),
    yardLocation: z.literal("Pickers Texarkana"),
    sourceSystem: z.literal("crush"),
    fields: z.object(apiFields).strict(),
  })
  .strict();
export type PickersRecord = z.infer<typeof PickersRecordSchema>;
export const PICKERS_SCOPE = {
  yardId: PICKERS_OPERATOR_ID,
  yardName: "Pickers Texarkana",
  sourceSystem: "crush",
  stockSchema: PickersStockSchema,
  maxStocks: PICKERS_MAX_NATIVE_STOCKS,
} as const;

export function parsePickersSearch(raw: string, pair: PickersPair) {
  return parseVinplusSearch(raw, PICKERS_SCOPE, pair).map((record) => {
    const fields = z.record(z.string(), z.unknown()).parse(record);
    return PickersRecordSchema.parse({
      stock: record.stock,
      year: record.year,
      yardLocation: record.yardLocation,
      sourceSystem: record.sourceSystem,
      fields: Object.fromEntries(
        Object.keys(apiFields).map((key) => {
          return [key, pickersValue(fields[key])];
        }),
      ),
    });
  });
}

function text(raw: string): string {
  const entities = new Map([
    ["amp", "&"],
    ["nbsp", " "],
    ["quot", '"'],
    ["apos", "'"],
    ["lt", "<"],
    ["gt", ">"],
    ["copy", "©"],
  ]);
  return raw
    .replace(/<[^>]*>/g, " ")
    .replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity: string, key: string) => {
      if (!key.startsWith("#")) {
        const result = entities.get(key.toLowerCase());
        if (result === undefined)
          throw new Error("Unsupported inventory entity " + entity);
        return result;
      }
      const hex = /^#x/i.test(key);
      const point = Number.parseInt(key.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (
        point <= 0 ||
        point > 0x10ffff ||
        (point >= 0xd800 && point <= 0xdfff)
      )
        throw new Error("Invalid inventory character reference");
      return String.fromCodePoint(point);
    })
    .replace(/\s+/g, " ")
    .trim();
}
function document(raw: string): string {
  if (Buffer.byteLength(raw) > 4 * 1024 * 1024 || !/<\/html>\s*$/i.test(raw))
    throw new Error("Pickers native HTML is oversized or incomplete");
  const html = stripInventoryRawText(raw);
  const body = text(html);
  if (
    !body.includes(PICKERS_YARD.address) ||
    !body.includes("Texarkana, AR 71854") ||
    !body.replace(/\D/g, "").includes("8707721880")
  )
    throw new Error("Pickers native Arkansas address or phone changed");
  return html;
}
export function parsePickersOwner(raw: string): string {
  const html = document(raw);
  const body = text(html);
  if (
    !body.includes(
      "maintaining an inventory of more than 500 vehicles, rotating constantly.",
    ) ||
    !body.includes("Self-Service Auto Parts")
  )
    throw new Error("Pickers active self-service inventory statement changed");
  return pickersHash({
    address: PICKERS_YARD.address,
    phone: PICKERS_YARD.phone,
    active: true,
  });
}

export function parsePickersInventory(raw: string) {
  const html = document(raw);
  const forms = [
    ...html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form\s*>/gi),
  ].filter(
    (match) =>
      inventoryHtmlAttribute(match[1] ?? "", "id") === "searchinventory",
  );
  const form = forms[0];
  if (
    forms.length !== 1 ||
    !form ||
    inventoryHtmlAttribute(form[1] ?? "", "action") !== "/Home/Inventory" ||
    inventoryHtmlAttribute(form[1] ?? "", "method")?.toLowerCase() !== "post"
  )
    throw new Error("Pickers published native inventory form changed");
  const selects = [
    ...(form[2] ?? "").matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select\s*>/gi),
  ];
  const makes = selects.filter(
    (match) => inventoryHtmlAttribute(match[1] ?? "", "name") === "VehicleMake",
  );
  const models = selects.filter(
    (match) =>
      inventoryHtmlAttribute(match[1] ?? "", "name") === "VehicleModel",
  );
  if (
    makes.length !== 1 ||
    models.length !== 1 ||
    selects.some(
      (match) => inventoryHtmlAttribute(match[1] ?? "", "required") !== null,
    )
  )
    throw new Error(
      "Pickers native selectors are missing, ambiguous or required",
    );
  const options = (select: string) =>
    [...select.matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option\s*>/gi)].map(
      (match) => ({
        value: text(inventoryHtmlAttribute(match[1] ?? "", "value") ?? ""),
        label: text(match[2] ?? ""),
      }),
    );
  const makeOptions = options(makes[0]?.[2] ?? "");
  const modelOptions = options(models[0]?.[2] ?? "");
  if (
    !makeOptions.some(
      (option) => option.value === "" && option.label === "Select Make",
    ) ||
    !modelOptions.some(
      (option) => option.value === "" && option.label === "Select Model",
    )
  )
    throw new Error("Pickers published empty native selector choices changed");
  const directory = z
    .array(z.string().min(1).max(200))
    .min(1)
    .max(PICKERS_MAX_MAKES)
    .parse(
      makeOptions
        .filter((option) => option.value)
        .map((option) => option.value),
    );
  if (new Set(directory).size !== directory.length)
    throw new Error("Pickers native make directory contains duplicates");
  const anchors = [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)];
  if (
    !anchors.some(
      (match) =>
        inventoryHtmlAttribute(match[1] ?? "", "href") === PICKERS_APP_URL,
    ) ||
    !anchors.some(
      (match) =>
        inventoryHtmlAttribute(match[1] ?? "", "href") === "/Home/PartPrices",
    )
  )
    throw new Error("Pickers native public app or prices destination changed");
  if (
    anchors.some((match) => {
      const attributes = match[1] ?? "";
      const url = URL.parse(
        inventoryHtmlAttribute(attributes, "href") ?? "",
        PICKERS_ORIGIN,
      );
      return (
        /^(?:next|last)$/i.test(text(match[2] ?? "")) ||
        /(?:^|\s)(?:next|last)(?:\s|$)/i.test(
          inventoryHtmlAttribute(attributes, "rel") ?? "",
        ) ||
        (url?.origin === PICKERS_ORIGIN &&
          ((url.pathname === "/Home/Inventory" && Boolean(url.search)) ||
            url.pathname.startsWith("/Home/Inventory/")))
      );
    })
  )
    throw new Error(
      "Pickers native inventory now requires unsupported pagination",
    );
  const tables = [...html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table\s*>/gi)];
  if (
    tables.length !== [...html.matchAll(/<table\b/gi)].length ||
    tables.length !== [...html.matchAll(/<\/table\b/gi)].length
  )
    throw new Error("Pickers native tables are incomplete or nested");
  const headers = [
    "YEAR",
    "MAKE",
    "MODEL",
    "COLOR",
    "REFERENCE",
    "ROW",
    "ARRIVAL DATE",
    "IMAGE",
  ];
  const inventory = tables.filter(
    (match) =>
      JSON.stringify(
        [...(match[1] ?? "").matchAll(/<th\b[^>]*>([\s\S]*?)<\/th\s*>/gi)].map(
          (cell) => text(cell[1] ?? ""),
        ),
      ) === JSON.stringify(headers),
  );
  if (inventory.length !== 1)
    throw new Error(
      "Pickers complete eight-column inventory table is missing or ambiguous",
    );
  const table = inventory[0]?.[1] ?? "";
  if (/<\/?(?:thead|tbody)\b/i.test(table))
    throw new Error("Pickers direct-row inventory grammar changed");
  const tableRows = [...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi)];
  const header = tableRows[0]?.[1] ?? "";
  if (
    [...header.matchAll(/<th\b[^>]*>[\s\S]*?<\/th\s*>/gi)].length !== 8 ||
    header.replace(/<th\b[^>]*>[\s\S]*?<\/th\s*>/gi, "").trim()
  )
    throw new Error("Pickers native header is not one complete eight-cell row");
  if (
    tableRows.length * 2 !== [...table.matchAll(/<\/?tr\b/gi)].length ||
    table.replace(/<tr\b[^>]*>[\s\S]*?<\/tr\s*>/gi, "").trim()
  )
    throw new Error(
      "Pickers native rows are incomplete or contain out-of-row content",
    );
  const rows = tableRows.slice(1).map((match) => {
    const row = match[1] ?? "";
    const cells = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td\s*>/gi)].map(
      (cell) => cell[1] ?? "",
    );
    if (
      cells.length !== 8 ||
      [...row.matchAll(/<\/?td\b/gi)].length !== 16 ||
      row.replace(/<td\b[^>]*>[\s\S]*?<\/td\s*>/gi, "").trim()
    )
      throw new Error(
        "Pickers native row does not contain eight complete cells",
      );
    const values = cells.map(text);
    const references = [
      ...(cells[7] ?? "").matchAll(/<(?:a|img)\b([^>]*)>/gi),
    ].flatMap((tag) => {
      const attributes = tag[1] ?? "";
      const value =
        inventoryHtmlAttribute(attributes, "href") ??
        inventoryHtmlAttribute(attributes, "src");
      if (!value) return [];
      const url = URL.parse(value, PICKERS_ORIGIN + "/Home/Inventory");
      if (!url) return [];
      const stock = /^\/PickersInventoryPhotos\/(STK\d{6})\.jpg$/.exec(
        url.pathname,
      )?.[1];
      return url.origin === PICKERS_ORIGIN &&
        !url.username &&
        !url.password &&
        stock
        ? [{ stock, url: url.href }]
        : [];
    });
    const stock = references[0]?.stock;
    if (!stock || references.some((reference) => reference.stock !== stock))
      throw new Error(
        "Pickers native stock reference is missing or conflicts within its source row",
      );
    return {
      stock,
      provenanceHash: pickersBodyHash(match[0]),
      year: /^\d{4}$/.test(values[0] ?? "") ? Number(values[0]) : null,
      make: values[1] ?? "",
      model: values[2] ?? "",
      color: pickersValue(values[3]),
      reference: pickersValue(values[4]),
      row: pickersValue(values[5]),
      date: pickersValue(values[6]),
      image: pickersValue(references[0]?.url),
    };
  });
  return { makes: directory, rows };
}

export function pickersPairs(rows: readonly PickersNativeRow[]): PickersPair[] {
  const pairs = new Map<string, PickersPair>();
  for (const row of rows)
    if (row.make && row.model) {
      const pair = PickersPairSchema.parse({
        make: row.make,
        model: row.model,
      });
      pairs.set(pickersPairKey(pair), pair);
    }
  return [...pairs.values()].sort((left, right) =>
    pickersPairKey(left) < pickersPairKey(right)
      ? -1
      : pickersPairKey(left) > pickersPairKey(right)
        ? 1
        : 0,
  );
}

/** Only the public app's published canonical yard-info bootstrap is required. */
export function parsePickersApp(raw: string): string {
  if (
    !/<\/html>\s*$/i.test(raw) ||
    !raw.includes(
      "var CLOUD_RUN_URL = 'https://inventory-search-api-581547763015.us-central1.run.app'",
    ) ||
    !raw.includes(
      "fetch(CLOUD_RUN_URL + '/api/yard-info/' + yardSlug.replace(/-/g, '_'))",
    )
  )
    throw new Error("Pickers public app canonical yard-info contract changed");
  return pickersHash({
    app: PICKERS_APP_URL,
    route: "/api/yard-info/",
    slugPolicy: "hyphen-to-underscore-v1",
  });
}

export function parsePickersConfig(raw: string): string {
  const config = z
    .object({
      success: z.literal(true),
      yard_info: z.object({
        yard_id: z.literal(PICKERS_OPERATOR_ID),
        resolved_location_id: z.literal(PICKERS_LOCATION_ID),
        multi_location_enabled: z.literal(true),
        per_location_mode_enabled: z.literal(true),
        status: z.string().optional(),
        features: z.object({
          alert_only_mode: z.literal(false),
          hide_vehicle_search: z.literal(false),
          demo_freshness_enabled: z.literal(false),
          demo_synthesize_alert_matches: z.literal(false),
        }),
        locations: z.array(
          z.object({
            location_id: z.string(),
            location_name: z.string(),
            city: z.string(),
            state: z.string(),
          }),
        ),
      }),
    })
    .parse(JSON.parse(raw));
  const info = config.yard_info;
  if (info.status && /^(?:archived|inactive|disabled)$/i.test(info.status))
    throw new Error("Pickers public inventory is explicitly disabled");
  const locations = info.locations.filter(
    (location) => location.location_id === PICKERS_LOCATION_ID,
  );
  const location = locations[0];
  if (
    locations.length !== 1 ||
    !location ||
    location.location_name !== "Pickers Texarkana" ||
    location.city.trim() !== "Texarkana" ||
    location.state !== "TX"
  )
    throw new Error(
      "Pickers resolved location or explicit Arkansas/vendor-Texas bridge changed",
    );
  return pickersHash({
    yard: info.yard_id,
    location,
    features: info.features,
    nativeState: "AR",
    vendorState: "TX",
  });
}
