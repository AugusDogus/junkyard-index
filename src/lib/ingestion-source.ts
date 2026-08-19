export const INGESTION_SOURCES = [
  "row52",
  "pyp",
  "autorecycler",
  "pullapart",
  "upullitne",
] as const;

export type IngestionSource = (typeof INGESTION_SOURCES)[number];
