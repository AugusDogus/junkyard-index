import { expect, test } from "bun:test";
import {
  ACTIVE_INGESTION_SOURCES,
  isRetiredIngestionSource,
} from "./ingestion-source";

test.each(["upullitne", "brandywine"] as const)(
  "retires %s, whose feed stopped reflecting its yard",
  (source) => {
    expect(isRetiredIngestionSource(source)).toBe(true);
    expect(ACTIVE_INGESTION_SOURCES).not.toContain(source);
  },
);
