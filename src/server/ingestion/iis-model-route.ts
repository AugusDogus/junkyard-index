import type { IisContext, IisControl } from "./iis-schema";

/** IIS parts menus publish an ampersand in a model slug as "_-and_". That
 * route returns an explicit "No Results Found" page, while the raw "_&_"
 * spelling lists every donor and donor links use "_and__". Menu and checkpoint
 * paths stay literal; only the model segment is translated. Use it only for
 * sources whose raw-ampersand routes were verified against saved captures. */
export interface IisModelRoute {
  requestPath: string;
  donorPath: string;
}

/** Advertised model donors and the badged explicit empties tolerated because
 * live probes proved their routes unreachable on this host. */
export interface IisModelReach {
  advertised: number;
  unreachable: IisControl[];
  unreachableCount: number;
  warnings: string[];
}

export type IisModelCoverage =
  | { ok: true; value: IisModelReach }
  | { ok: false; detail: string };

const EMPTY = 'an explicit "No Results Found" page';

const withModel = (path: string, change: (model: string) => string) => {
  const parts = path.split("/");
  const model = parts[3];
  return model
    ? [...parts.slice(0, 3), change(model), ...parts.slice(4)].join("/")
    : path;
};

const donors = (count: number) => `${count} donor${count === 1 ? "" : "s"}`;

const listed = (models: readonly IisControl[]) =>
  models.map((model) => `${model.label}: ${model.count} [${model.path}]`);

export const IisModelRoute = {
  of(path: string): IisModelRoute {
    return {
      requestPath: withModel(path, (model) =>
        model.replaceAll("_-and_", "_&_"),
      ),
      donorPath: withModel(path, (model) =>
        model.replaceAll("_-and_", "_and__"),
      ),
    };
  },
  donorControl(control: IisControl): IisControl {
    return { ...control, path: IisModelRoute.of(control.path).donorPath };
  },
  /**
   * A badged explicit empty means the census silently lost advertised donors.
   * It fails unless the route is in `unreachable`, the exact model paths that
   * live probes proved list no donors on this host under any spelling, and
   * all such routes together hold at most 1% of the advertised model badges.
   * Dots and parentheses alone prove nothing: Pratt lists donors on literal
   * `SAFARI_(GMC)` and `BLAZER.JIMMY_(FULL_SIZE)` routes.
   */
  coverage(
    menus: readonly { make: IisControl; models: readonly IisControl[] }[],
    pages: readonly { context: IisContext; nativeEmpty: boolean }[],
    unreachable: ReadonlySet<string>,
  ): IisModelCoverage {
    const reasons = menus
      .filter((menu) => menu.models.length === 0 && menu.make.count > 0)
      .map(
        ({ make }) =>
          `make ${make.path} advertises ${donors(make.count)} but its model directory is ${EMPTY}`,
      );
    const tolerated: IisControl[] = [];
    for (const page of pages) {
      if (
        page.context.kind !== "model" ||
        !page.nativeEmpty ||
        page.context.model.count === 0
      )
        continue;
      const model = page.context.model;
      if (unreachable.has(model.path)) tolerated.push(model);
      else
        reasons.push(
          `model ${model.path} advertises ${donors(model.count)} but ${IisModelRoute.of(model.path).requestPath} returned ${EMPTY}`,
        );
    }
    const advertised = menus
      .flatMap((menu) => menu.models)
      .reduce((total, model) => total + model.count, 0);
    const unreachableCount = tolerated.reduce(
      (total, model) => total + model.count,
      0,
    );
    if (unreachableCount * 100 > advertised)
      reasons.push(
        `${unreachableCount}/${advertised} advertised model donors sit on routes proven unreachable on this host (${listed(tolerated).join(", ")}), above the 1% allowance`,
      );
    if (reasons.length)
      return {
        ok: false,
        detail: `${reasons.join("; ")}. The census would silently drop advertised donors, so nothing is published. Probe each named route: if another spelling lists its donors, fix the request spelling; if the route is spelled correctly and the site lists no donors, the badge is stale and every run fails until it clears, so escalate. Resuming this checkpoint repeats the failure, so start a new run after the fix`,
      };
    return {
      ok: true,
      value: {
        advertised,
        unreachable: tolerated,
        unreachableCount,
        warnings: tolerated.length
          ? [
              `${unreachableCount}/${advertised} advertised model donors sit on routes proven unreachable on this host (${listed(tolerated).join(", ")}); the maximum is 1%.`,
            ]
          : [],
      },
    };
  },
} as const;
