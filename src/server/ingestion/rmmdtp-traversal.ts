import type { RmmdtpContract } from "./rmmdtp-contract";
import {
  RmmdtpCursor,
  rmmdtpGraphUrl,
  type RmmdtpCursor as Cursor,
} from "./rmmdtp-cursor";
import { parseRmmdtpPage } from "./rmmdtp-parser";
import { RmmdtpResult } from "./rmmdtp-result";

export function rmmdtpNextUrl(cursor: Cursor) {
  return RmmdtpResult.boundary("next native control", () => {
    if (cursor.phase === "ready" || cursor.phase === "complete")
      throw new Error("A closed native graph has no unread destination");
    return rmmdtpGraphUrl(
      cursor.pages,
      cursor.phase === "opening" ? cursor.pages.length : cursor.closed.length,
    );
  });
}
export function rmmdtpAdvance(
  cursor: Cursor,
  raw: string,
  contract: RmmdtpContract,
) {
  return RmmdtpResult.boundary("native traversal", () => {
    if (cursor.phase === "ready" || cursor.phase === "complete")
      throw new Error("A closed native graph cannot accept another response");
    const page = parseRmmdtpPage(
      raw,
      (cursor.phase === "opening"
        ? cursor.pages.length
        : cursor.closed.length) + 1,
    );
    const base = {
      source: cursor.source,
      version: cursor.version,
      scope: cursor.scope,
      requests: cursor.requests + 1,
      bytes: cursor.bytes + page.bodyBytes,
    };
    const next =
      cursor.phase === "opening"
        ? RmmdtpCursor.checkpoint(
            page.nextUrl === null
              ? {
                  ...base,
                  pages: [...cursor.pages, page],
                  phase: "closing",
                  closed: [],
                }
              : { ...base, pages: [...cursor.pages, page], phase: "opening" },
            contract,
          )
        : RmmdtpCursor.checkpoint(
            {
              ...base,
              pages: cursor.pages,
              closed: [
                ...cursor.closed,
                { hash: page.hash, bodyBytes: page.bodyBytes },
              ],
              phase:
                cursor.closed.length + 1 === cursor.pages.length
                  ? "ready"
                  : "closing",
            },
            contract,
          );
    if (!next.ok) throw new Error(next.error.message);
    return next.value;
  });
}
