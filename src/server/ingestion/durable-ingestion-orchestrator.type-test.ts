import {
  ingestDurableSource,
  type DurableSourceOperations,
} from "./durable-ingestion-orchestrator";

declare const row52Operations: DurableSourceOperations<"row52">;

void ingestDurableSource({
  runId: "type-test",
  initialCursor: { source: "pyp", page: 1 },
  // @ts-expect-error Row52 operations cannot run from a PYP cursor.
  operations: row52Operations,
});
