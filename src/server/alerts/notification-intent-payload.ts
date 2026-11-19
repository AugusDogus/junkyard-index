import { ArrivalDate } from "~/lib/arrival-date";
import { z } from "zod";
import { INGESTION_SOURCES } from "~/lib/ingestion-source";
import {
  SearchAlertMatch,
  type SearchAlertData,
} from "~/lib/search-alert-data";

const SearchVehicleFields = z
  .object({
    id: z.string(),
    year: z.number(),
    make: z.string(),
    model: z.string(),
    color: z.string(),
    vin: z.string(),
    stockNumber: z.string(),
    source: z.enum(INGESTION_SOURCES),
    locationCode: z.string(),
    locationName: z.string(),
    locationCity: z.string(),
    state: z.string(),
    stateAbbr: z.string(),
    lat: z.number(),
    lng: z.number(),
    distance: z.number().nullable(),
    section: z.string(),
    row: z.string(),
    space: z.string(),
    imageUrl: z.string().nullable(),
    detailsUrl: z.string().nullable(),
    partsUrl: z.string(),
    pricesUrl: z.string(),
    engine: z.string().optional(),
    trim: z.string().optional(),
    transmission: z.string().optional(),
    isMissing: z.boolean().optional(),
    missingSinceAt: z.string().optional(),
    missingRunCount: z.number().optional(),
  })
  .strict();

// Pending intents created before arrival provenance was added still carry a raw date.
const SearchVehicleSchema = z.union([
  SearchVehicleFields.extend({ arrivalDate: ArrivalDate.schema }),
  SearchVehicleFields.extend({ availableDate: z.string() }).transform(
    ({ availableDate, ...vehicle }) => ({
      ...vehicle,
      arrivalDate: ArrivalDate.from(availableDate, null),
    }),
  ),
]);

const IntentPayloadSchema = z
  .object({
    searchName: z.string(),
    query: z.string(),
    searchUrl: z.string(),
    searchId: z.string(),
    match: z.object({
      count: z.number().int().positive(),
      previewVehicles: z.array(SearchVehicleSchema),
    }),
  })
  .strict();

export function parseNotificationIntentPayload(value: string): SearchAlertData {
  const parsed = IntentPayloadSchema.parse(JSON.parse(value));
  return {
    searchName: parsed.searchName,
    query: parsed.query,
    searchUrl: parsed.searchUrl,
    searchId: parsed.searchId,
    match: SearchAlertMatch.create(
      parsed.match.count,
      parsed.match.previewVehicles,
    ),
  };
}
