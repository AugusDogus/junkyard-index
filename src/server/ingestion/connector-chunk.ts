import type { PipelineSourceName } from "./pipeline-policy";

export type ConnectorChunkStatus = "paused" | "complete" | "failed";

export interface ConnectorChunkResult<
  Source extends PipelineSourceName,
  Cursor,
> {
  source: Source;
  status: ConnectorChunkStatus;
  cursor: Cursor;
  count: number;
  errors: string[];
  pagesProcessed: number;
}
