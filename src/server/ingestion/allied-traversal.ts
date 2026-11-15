import type { AlliedContract } from "./allied-contract";
import { AlliedCursor } from "./allied-cursor";
import { ALLIED_ARRIVALS, ALLIED_MAKES, ALLIED_ORIGIN } from "./allied-html";
import {
  parseAlliedArrivals,
  parseAlliedDirectory,
  parseAlliedModel,
  parseAlliedOwner,
  alliedHash,
} from "./allied-parser";
import { AlliedResult } from "./allied-result";
import { alliedModels } from "./allied-snapshot";

export function alliedNextUrl(
  cursor: AlliedCursor,
): import("./allied-result").AlliedResult<string> {
  switch (cursor.phase) {
    case "owner":
      return { ok: true, value: ALLIED_ORIGIN + "/" };
    case "arrivals":
      return { ok: true, value: ALLIED_ARRIVALS };
    case "directory":
      return { ok: true, value: ALLIED_MAKES };
    case "makes": {
      const make = cursor.makes[cursor.menus.length];
      return make
        ? { ok: true, value: ALLIED_ORIGIN + make.path }
        : {
            ok: false,
            error: AlliedResult.error(
              "next make",
              "Published make prefix has no next control",
            ),
          };
    }
    case "models": {
      const model = alliedModels(cursor.menus)[cursor.pages.length];
      return model
        ? { ok: true, value: ALLIED_ORIGIN + model.model.path }
        : {
            ok: false,
            error: AlliedResult.error(
              "next model",
              "Published model prefix has no next control",
            ),
          };
    }
    case "closing": {
      const path =
        cursor.closingIndex === 0
          ? "/"
          : cursor.closingIndex === 1
            ? "/parts/"
            : cursor.makes[cursor.closingIndex - 2]?.path;
      return path
        ? { ok: true, value: ALLIED_ORIGIN + path }
        : {
            ok: false,
            error: AlliedResult.error(
              "closing control",
              "Published closing frontier has no next control",
            ),
          };
    }
    case "ready":
    case "complete":
      return {
        ok: false,
        error: AlliedResult.error(
          "next control",
          "Terminal graph has no unread native control",
        ),
      };
  }
}

export function alliedAdvance(
  cursor: AlliedCursor,
  raw: string,
  contract: AlliedContract,
): import("./allied-result").AlliedResult<AlliedCursor> {
  const base = {
    source: cursor.source,
    version: cursor.version,
    scope: cursor.scope,
    requests: cursor.requests + 1,
    bytes: cursor.bytes + Buffer.byteLength(raw),
  };
  switch (cursor.phase) {
    case "owner": {
      const owner = parseAlliedOwner(raw, contract.yard);
      return owner.ok
        ? AlliedCursor.checkpoint(
            { ...base, phase: "arrivals", ownerHash: owner.value },
            contract,
          )
        : owner;
    }
    case "arrivals": {
      const page = parseAlliedArrivals(raw);
      return page.ok
        ? AlliedCursor.checkpoint(
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
      const makes = parseAlliedDirectory(raw, { kind: "makes" });
      return makes.ok
        ? AlliedCursor.checkpoint(
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
          error: AlliedResult.error(
            "make transition",
            "Published make is missing",
          ),
        };
      const models = parseAlliedDirectory(raw, { kind: "models", make });
      if (!models.ok) return models;
      const menus = [...cursor.menus, { make, models: models.value }];
      return menus.length === cursor.makes.length
        ? AlliedCursor.checkpoint(
            {
              ...cursor,
              ...base,
              menus,
              pages: [],
              ...(alliedModels(menus).length
                ? { phase: "models" as const }
                : { phase: "closing" as const, closingIndex: 0 }),
            },
            contract,
          )
        : AlliedCursor.checkpoint({ ...cursor, ...base, menus }, contract);
    }
    case "models": {
      const context = alliedModels(cursor.menus)[cursor.pages.length];
      if (!context)
        return {
          ok: false,
          error: AlliedResult.error(
            "model transition",
            "Published model is missing",
          ),
        };
      const page = parseAlliedModel(raw, context);
      if (!page.ok) return page;
      const pages = [...cursor.pages, page.value];
      return AlliedCursor.checkpoint(
        {
          ...cursor,
          ...base,
          pages,
          ...(pages.length === alliedModels(cursor.menus).length
            ? { phase: "closing" as const, closingIndex: 0 }
            : { phase: "models" as const }),
        },
        contract,
      );
    }
    case "closing": {
      let actual: import("./allied-result").AlliedResult<string>;
      let expected: string;
      if (cursor.closingIndex === 0) {
        actual = parseAlliedOwner(raw, contract.yard);
        expected = cursor.ownerHash;
      } else {
        const make = cursor.makes[cursor.closingIndex - 2];
        const parsed =
          cursor.closingIndex === 1
            ? parseAlliedDirectory(raw, { kind: "makes" })
            : make
              ? parseAlliedDirectory(raw, { kind: "models", make })
              : ({
                  ok: false,
                  error: AlliedResult.error(
                    "closing make",
                    "Native closing make is missing",
                  ),
                } as const);
        if (!parsed.ok) return parsed;
        actual = { ok: true, value: alliedHash(parsed.value) };
        expected = alliedHash(
          cursor.closingIndex === 1
            ? cursor.makes
            : cursor.menus[cursor.closingIndex - 2]?.models,
        );
      }
      if (!actual.ok) return actual;
      if (actual.value !== expected)
        return {
          ok: false,
          error: AlliedResult.error(
            "closing graph drift",
            "Official owner or published make/model controls changed during enumeration; restart from the owner",
          ),
        };
      const { closingIndex, ...rest } = cursor;
      return AlliedCursor.checkpoint(
        closingIndex + 1 === cursor.makes.length + 2
          ? { ...rest, ...base, phase: "ready" }
          : {
              ...rest,
              ...base,
              phase: "closing",
              closingIndex: closingIndex + 1,
            },
        contract,
      );
    }
    case "ready":
    case "complete":
      return {
        ok: false,
        error: AlliedResult.error(
          "transition",
          "Terminal graph cannot accept another native response",
        ),
      };
  }
}

/** IIS badges describe category memberships, not an authoritative donor total. */
export function alliedCountWarnings(cursor: AlliedCursor): string[] {
  if (!("pages" in cursor)) return [];
  const makeBadges = cursor.makes.reduce((n, make) => n + make.count, 0);
  const modelBadges = cursor.menus
    .flatMap((m) => m.models)
    .reduce((n, model) => n + model.count, 0);
  const modelCards = cursor.pages.reduce(
    (n, page) => n + page.records.length,
    0,
  );
  const mismatches = cursor.pages.filter(
    (page) =>
      page.context.kind === "model" &&
      page.records.length !== page.context.model.count,
  ).length;
  return [
    `Allied enumerated ${modelCards} model cards plus ${cursor.arrivals.records.length} arrivals. Published make badges sum to ${makeBadges}; model badges sum to ${modelBadges}; ${mismatches} model pages disagree with their badges. These category counts are diagnostic, not a yard total.`,
  ];
}
