import type { PrattContract } from "./pratt-contract";
import { PrattCursor } from "./pratt-cursor";
import { IisModelRoute } from "./iis-model-route";
import { PRATT_ARRIVALS, PRATT_MAKES, PRATT_ORIGIN } from "./pratt-html";
import {
  parsePrattArrivals,
  parsePrattDirectory,
  parsePrattModel,
  parsePrattOwner,
} from "./pratt-parser";
import { PrattResult } from "./pratt-result";
import { prattModels } from "./pratt-snapshot";

export function prattNextUrl(
  cursor: PrattCursor,
): import("./pratt-result").PrattResult<string> {
  switch (cursor.phase) {
    case "owner":
      return { ok: true, value: PRATT_ORIGIN + "/" };
    case "arrivals":
      return { ok: true, value: PRATT_ARRIVALS };
    case "directory":
      return { ok: true, value: PRATT_MAKES };
    case "makes": {
      const make = cursor.makes[cursor.menus.length];
      return make
        ? { ok: true, value: PRATT_ORIGIN + make.path }
        : {
            ok: false,
            error: PrattResult.error(
              "next make",
              "Published make prefix has no next control",
            ),
          };
    }
    case "models": {
      const model = prattModels(cursor.menus)[cursor.pages.length];
      return model
        ? {
            ok: true,
            value:
              PRATT_ORIGIN + IisModelRoute.of(model.model.path).requestPath,
          }
        : {
            ok: false,
            error: PrattResult.error(
              "next model",
              "Published model prefix has no next control",
            ),
          };
    }
    case "ready":
    case "complete":
      return {
        ok: false,
        error: PrattResult.error(
          "next control",
          "Terminal graph has no unread native control",
        ),
      };
  }
}

export function prattAdvance(
  cursor: PrattCursor,
  raw: string,
  contract: PrattContract,
): import("./pratt-result").PrattResult<PrattCursor> {
  const base = {
    source: cursor.source,
    version: cursor.version,
    scope: cursor.scope,
    requests: cursor.requests + 1,
    bytes: cursor.bytes + Buffer.byteLength(raw),
  };
  switch (cursor.phase) {
    case "owner": {
      const owner = parsePrattOwner(raw, contract.yard);
      return owner.ok
        ? PrattCursor.checkpoint(
            { ...base, phase: "arrivals", ownerHash: owner.value },
            contract,
          )
        : owner;
    }
    case "arrivals": {
      const page = parsePrattArrivals(raw);
      return page.ok
        ? PrattCursor.checkpoint(
            {
              ...base,
              phase: "directory",
              ownerHash: cursor.ownerHash,
              arrivals: page.value,
            },
            contract,
          )
        : page;
    }
    case "directory": {
      const makes = parsePrattDirectory(raw, { kind: "makes" });
      return makes.ok
        ? PrattCursor.checkpoint(
            {
              ...cursor,
              ...base,
              phase: "makes",
              makes: makes.value,
              menus: [],
            },
            contract,
          )
        : makes;
    }
    case "makes": {
      const make = cursor.makes[cursor.menus.length];
      if (!make)
        return {
          ok: false,
          error: PrattResult.error(
            "make transition",
            "Published make is missing",
          ),
        };
      const models = parsePrattDirectory(raw, { kind: "models", make });
      if (!models.ok) return models;
      const menus = [...cursor.menus, { make, models: models.value }];
      return menus.length === cursor.makes.length
        ? PrattCursor.checkpoint(
            {
              ...cursor,
              ...base,
              menus,
              pages: [],
              phase: prattModels(menus).length ? "models" : "ready",
            },
            contract,
          )
        : PrattCursor.checkpoint({ ...cursor, ...base, menus }, contract);
    }
    case "models": {
      const context = prattModels(cursor.menus)[cursor.pages.length];
      if (!context)
        return {
          ok: false,
          error: PrattResult.error(
            "model transition",
            "Published model is missing",
          ),
        };
      const page = parsePrattModel(raw, context);
      if (!page.ok) return page;
      const pages = [...cursor.pages, page.value];
      return PrattCursor.checkpoint(
        {
          ...cursor,
          ...base,
          pages,
          phase:
            pages.length === prattModels(cursor.menus).length
              ? "ready"
              : "models",
        },
        contract,
      );
    }
    case "ready":
    case "complete":
      return {
        ok: false,
        error: PrattResult.error(
          "transition",
          "Terminal graph cannot accept another native response",
        ),
      };
  }
}
