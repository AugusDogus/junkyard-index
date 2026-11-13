import type { Cars4PartsContract } from "./cars4parts-contract";
import {
  Cars4PartsCursor,
  cars4partsLeafDestinations,
  type Cars4PartsCursor as Cursor,
} from "./cars4parts-cursor";
import { CARS4PARTS_INVENTORY, CARS4PARTS_ORIGIN } from "./cars4parts-html";
import {
  parseCars4PartsInventory,
  parseCars4PartsLeaf,
  parseCars4PartsResults,
} from "./cars4parts-parser";
import {
  Cars4PartsResult,
  type Cars4PartsResult as Result,
} from "./cars4parts-result";

/** Literal source search.js formula: published page-N hash becomes page=N&,
 * followed by its unnamed Math.random cachebuster. No filters are synthesized. */
export function cars4partsResultUrl(
  page: number | null,
  nonce = Math.random(),
) {
  if (
    (page !== null &&
      (!Number.isSafeInteger(page) || page < 1 || page > 200)) ||
    !Number.isFinite(nonce) ||
    nonce < 0 ||
    nonce >= 1
  )
    throw new Error("Invalid native page control or cachebuster");
  return (
    CARS4PARTS_ORIGIN +
    "/wp-admin/admin-ajax.php?action=ajax_custom_search&cps_use_ajax=1&" +
    (page === null ? "" : `page=${page}&`) +
    nonce
  );
}
function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}
export function cars4partsNextUrl(cursor: Cursor) {
  return Cars4PartsResult.boundary("next native control", () => {
    switch (cursor.phase) {
      case "inventory":
        return CARS4PARTS_INVENTORY;
      case "opening":
        return cars4partsResultUrl(
          cursor.pages.length === 0 ? null : cursor.pages.length + 1,
        );
      case "leaves": {
        const next = cars4partsLeafDestinations(cursor.pages)[
          cursor.records.length
        ];
        if (!next) throw new Error("Next published native leaf is missing");
        return next;
      }
      case "closing":
        return cars4partsResultUrl(
          cursor.closed === 0 ? null : cursor.closed + 1,
        );
      case "ready":
      case "complete":
        throw new Error("A finished native graph has no unread request");
    }
  });
}
export function cars4partsAdvance(
  cursor: Cursor,
  raw: string,
  contract: Cars4PartsContract,
) {
  return Cars4PartsResult.boundary("native traversal", () => {
    const base = {
      source: cursor.source,
      version: cursor.version,
      scope: cursor.scope,
      requests: cursor.requests + 1,
      bytes: cursor.bytes + Buffer.byteLength(raw),
    };
    switch (cursor.phase) {
      case "inventory": {
        const native = unwrap(parseCars4PartsInventory(raw));
        return unwrap(
          Cars4PartsCursor.checkpoint(
            {
              ...base,
              phase: "opening",
              makes: native.makes,
              inventoryHash: native.hash,
              pages: [],
            },
            contract,
          ),
        );
      }
      case "opening": {
        const page = unwrap(
          parseCars4PartsResults(raw, cursor.pages.length + 1),
        );
        const pages = [...cursor.pages, page];
        const native = {
          makes: cursor.makes,
          inventoryHash: cursor.inventoryHash,
          pages,
        };
        return unwrap(
          Cars4PartsCursor.checkpoint(
            pages.length === page.pages.length
              ? { ...base, ...native, phase: "leaves", records: [] }
              : { ...base, ...native, phase: "opening" },
            contract,
          ),
        );
      }
      case "leaves": {
        const destinations = cars4partsLeafDestinations(cursor.pages),
          destination = destinations[cursor.records.length];
        if (!destination)
          throw new Error("Native detail has no published destination");
        const records = [
          ...cursor.records,
          unwrap(parseCars4PartsLeaf(raw, destination)),
        ];
        const native = {
          makes: cursor.makes,
          inventoryHash: cursor.inventoryHash,
          pages: cursor.pages,
          records,
        };
        return unwrap(
          Cars4PartsCursor.checkpoint(
            records.length === destinations.length
              ? { ...base, ...native, phase: "closing", closed: 0 }
              : { ...base, ...native, phase: "leaves" },
            contract,
          ),
        );
      }
      case "closing": {
        const page = unwrap(parseCars4PartsResults(raw, cursor.closed + 1));
        if (page.hash !== cursor.pages[cursor.closed]?.hash)
          throw new Error(
            "Closing native result graph changed; no vehicles may be emitted",
          );
        const closed = cursor.closed + 1;
        return unwrap(
          Cars4PartsCursor.checkpoint(
            {
              ...base,
              makes: cursor.makes,
              inventoryHash: cursor.inventoryHash,
              pages: cursor.pages,
              records: cursor.records,
              closed,
              phase: closed === cursor.pages.length ? "ready" : "closing",
            },
            contract,
          ),
        );
      }
      case "ready":
      case "complete":
        throw new Error(
          "Native graph is already closed and cannot accept another response",
        );
    }
  });
}
