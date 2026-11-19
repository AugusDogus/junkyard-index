import { z } from "zod";
import { SearchFilterUrl } from "./search-filter-url";

const schema = z.enum(["24h", "48h", "7d"]);
export type ArrivalWindow = z.infer<typeof schema>;

export const ARRIVAL_WINDOWS = [
  { value: "24h", label: "Last 24 hours", hours: 24 },
  { value: "48h", label: "Last 48 hours", hours: 48 },
  { value: "7d", label: "Last 7 days", hours: 168 },
] as const;

function parse(value: unknown): ArrivalWindow | undefined {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function fromUrl(params: URLSearchParams): ArrivalWindow | undefined {
  return parse(SearchFilterUrl.read(params, "arrivalWindow")[0]);
}

/** Rolling seconds, using #162's yard or observed date. Unknown dates have timestamp 0. */
function filter(
  value: ArrivalWindow | undefined,
  now = Date.now(),
): string | undefined {
  if (!value) return undefined;
  const hours = ARRIVAL_WINDOWS.find((option) => option.value === value)?.hours;
  if (hours === undefined) return undefined;
  const end = Math.floor(now / 1000);
  return `availableDateTs >= ${end - hours * 3600} AND availableDateTs <= ${end}`;
}

export const ArrivalWindow = { schema, parse, fromUrl, filter } as const;
