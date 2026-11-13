import type { RmmdtpStreamResult } from "../src/server/ingestion/rmmdtp-connector";
import {
  RmmdtpCursor,
  RMMDTP_MAX_REQUESTS,
} from "../src/server/ingestion/rmmdtp-cursor";
import { RMMDTP_CONTRACT } from "../src/server/ingestion/rmmdtp-configuration";

/** Count-only runner. Complete graph evidence survives every checkpoint. */
export async function soakRmmdtpInventory(
  runChunk: (
    cursor: RmmdtpCursor,
    maxPages: number,
  ) => Promise<RmmdtpStreamResult>,
  maxPages = RMMDTP_MAX_REQUESTS,
): Promise<RmmdtpStreamResult> {
  if (!Number.isSafeInteger(maxPages) || maxPages < 1)
    throw new Error("RMMDTP soak requires a positive native-request budget");
  let cursor = RmmdtpCursor.initial(RMMDTP_CONTRACT);
  let pagesProcessed = 0;
  while (pagesProcessed < maxPages) {
    const chunk = await runChunk(
      cursor,
      Math.min(8, maxPages - pagesProcessed),
    );
    if (chunk.status === "paused" && chunk.pagesProcessed === 0)
      throw new Error(
        "RMMDTP soak made no progress; retain the last validated checkpoint and inspect the source",
      );
    pagesProcessed += chunk.pagesProcessed;
    const payload: unknown = JSON.parse(JSON.stringify(chunk.cursor));
    const parsed = RmmdtpCursor.parse(payload, RMMDTP_CONTRACT);
    if (!parsed.ok) throw new Error(parsed.error.message);
    cursor = parsed.value;
    if (chunk.status === "complete" || pagesProcessed === maxPages)
      return { ...chunk, cursor, pagesProcessed };
  }
  throw new Error("RMMDTP soak exhausted its budget without a result");
}
