export const INGESTION_SOURCES = [
  "row52",
  "pyp",
  "autorecycler",
  "pullapart",
  "upullitne",
  "upullitdavie",
  "gopullit",
] as const;

export type IngestionSource = (typeof INGESTION_SOURCES)[number];
