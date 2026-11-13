import {
  CALTON_MAKES,
  CALTON_ROOT,
  CaltonError,
  caltonBoundary,
  caltonControlUrl,
  type CaltonContract,
  type CaltonResult,
} from "./calton-contract";
import { CaltonCursor, caltonModels } from "./calton-cursor";
import { CALTON_MAX_BODY_BYTES } from "./calton-client";
import { parseCaltonDirectory, parseCaltonPage } from "./calton-parser";

export function caltonNextUrl(cursor: CaltonCursor): CaltonResult<string> {
  let url: string | null = null;
  switch (cursor.phase) {
    case "arrivals":
      url = CALTON_ROOT;
      break;
    case "directory":
      url = CALTON_MAKES;
      break;
    case "menus": {
      const make = cursor.makes.controls[cursor.menus.length];
      url = make ? caltonControlUrl(make, 2) : null;
      break;
    }
    case "models": {
      const entry = caltonModels(cursor.menus)[cursor.pages.length];
      url = entry ? caltonControlUrl(entry.model, 3) : null;
      break;
    }
    case "ready":
    case "complete":
      break;
  }
  return url
    ? { ok: true, value: url }
    : {
        ok: false,
        error: CaltonError.create(
          "next literal control",
          "Terminal or incomplete graph has no next owned published destination",
        ),
      };
}

export function caltonAdvance(
  input: CaltonCursor,
  raw: string,
  contract: CaltonContract,
): CaltonResult<CaltonCursor> {
  const checked = CaltonCursor.parse(input, contract);
  if (!checked.ok) return checked;
  const cursor = checked.value;
  return caltonBoundary("native graph transition", () => {
    const bytes = Buffer.byteLength(raw);
    if (!bytes || bytes > CALTON_MAX_BODY_BYTES)
      throw new Error(
        "Native response is empty or exceeds the 2 MiB capture bound",
      );
    const base = {
      source: cursor.source,
      version: cursor.version,
      scope: cursor.scope,
      requests: cursor.requests + 1,
      bytes: cursor.bytes + bytes,
    };
    const next = caltonNextUrl(cursor);
    if (!next.ok) throw new Error(next.error.message);
    let state: unknown;
    if (cursor.phase === "arrivals") {
      const result = parseCaltonPage(raw, {
        kind: "arrivals",
        sourceUrl: next.value,
      });
      if (!result.ok) throw new Error(result.error.message);
      state = { ...base, phase: "directory", arrivals: result.value };
    } else if (cursor.phase === "directory") {
      const result = parseCaltonDirectory(raw, {
        kind: "makes",
        sourceUrl: next.value,
      });
      if (!result.ok) throw new Error(result.error.message);
      state = {
        ...cursor,
        ...base,
        phase: "menus",
        makes: { ...result.value, bytes },
        menus: [],
      };
    } else if (cursor.phase === "menus") {
      const make = cursor.makes.controls[cursor.menus.length];
      if (!make) throw new Error("Published make control is missing");
      const result = parseCaltonDirectory(raw, {
        kind: "models",
        sourceUrl: next.value,
        make,
      });
      if (!result.ok) throw new Error(result.error.message);
      const menus = [
        ...cursor.menus,
        { make, directory: { ...result.value, bytes } },
      ];
      state =
        menus.length === cursor.makes.controls.length
          ? {
              ...cursor,
              ...base,
              menus,
              pages: [],
              phase: caltonModels(menus).length ? "models" : "ready",
            }
          : { ...cursor, ...base, menus };
    } else if (cursor.phase === "models") {
      const context = caltonModels(cursor.menus)[cursor.pages.length];
      if (!context) throw new Error("Published model control is missing");
      const result = parseCaltonPage(raw, {
        kind: "model",
        sourceUrl: next.value,
        ...context,
      });
      if (!result.ok) throw new Error(result.error.message);
      const pages = [...cursor.pages, result.value];
      state = {
        ...cursor,
        ...base,
        pages,
        phase:
          pages.length === caltonModels(cursor.menus).length
            ? "ready"
            : "models",
      };
    } else
      throw new Error("Terminal graph cannot accept another native response");
    const checkpoint = CaltonCursor.checkpoint(state, contract);
    if (!checkpoint.ok) throw new Error(checkpoint.error.message);
    return checkpoint.value;
  });
}
