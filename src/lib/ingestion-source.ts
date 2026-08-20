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

export const INGESTION_SOURCE_DISPLAY_NAMES = {
  row52: "Row52",
  pyp: "LKQ Pick Your Part",
  autorecycler: "AutoRecycler.io",
  pullapart: "Pull-A-Part / U-Pull-&-Pay",
  upullitne: "U Pull-It Nebraska",
  upullitdavie: "U Pull It Davie",
  gopullit: "GO Pull-It",
} as const satisfies Record<IngestionSource, string>;

export function mapIngestionSources<Value>(
  transform: (source: IngestionSource) => Value,
): Record<IngestionSource, Value> {
  return {
    row52: transform("row52"),
    pyp: transform("pyp"),
    autorecycler: transform("autorecycler"),
    pullapart: transform("pullapart"),
    upullitne: transform("upullitne"),
    upullitdavie: transform("upullitdavie"),
    gopullit: transform("gopullit"),
  };
}

export function isIngestionSource(value: unknown): value is IngestionSource {
  return (
    typeof value === "string" &&
    INGESTION_SOURCES.some((source) => source === value)
  );
}
