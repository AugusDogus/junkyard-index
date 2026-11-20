import { expect, test } from "bun:test";
import { IisModelRoute } from "./iis-model-route";
import type { IisControl } from "./iis-schema";

const control = (path: string, count: number): IisControl => ({
  path,
  label: path.split("/")[3] ?? "",
  count,
});
const make = (path: string, count: number) => control(path, count);
const NONE: ReadonlySet<string> = new Set();
const page = (model: IisControl, records: number) => ({
  context: { kind: "model" as const, make: make("/parts/X", 0), model },
  nativeEmpty: records === 0,
});

test("IIS model route translates only the model segment's -and token", () => {
  expect(IisModelRoute.of("/parts/CHRYSLER/TOWN_-and_COUNTRY/")).toEqual({
    requestPath: "/parts/CHRYSLER/TOWN_&_COUNTRY/",
    donorPath: "/parts/CHRYSLER/TOWN_and__COUNTRY/",
  });
  expect(
    IisModelRoute.of("/parts/MAKE_-and_X/MODEL_-and_X/STOCK_-and_X/2005"),
  ).toEqual({
    requestPath: "/parts/MAKE_-and_X/MODEL_&_X/STOCK_-and_X/2005",
    donorPath: "/parts/MAKE_-and_X/MODEL_and__X/STOCK_-and_X/2005",
  });
  for (const path of ["/parts/FORD/F150/", "/parts/FORD", "/parts/LAND_ROVER/"])
    expect(IisModelRoute.of(path)).toEqual({
      requestPath: path,
      donorPath: path,
    });
});

test("IIS coverage fails a badged explicit empty on an ordinary or ampersand route", () => {
  const ordinary = control("/parts/FORD/F150/", 3);
  const ampersand = control("/parts/CHRYSLER/TOWN_-and_COUNTRY/", 15);
  const filler = control("/parts/FORD/FOCUS/", 1000);
  for (const [model, request] of [
    [ordinary, "/parts/FORD/F150/"],
    [ampersand, "/parts/CHRYSLER/TOWN_&_COUNTRY/"],
  ] as const) {
    const result = IisModelRoute.coverage(
      [{ make: make("/parts/FORD", 1003), models: [model, filler] }],
      [page(model, 0), page(filler, 1000)],
      NONE,
    );
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.detail).toContain(
        `model ${model.path} advertises ${model.count} donors but ${request} returned an explicit`,
      );
  }
  // An unbadged empty and a badged populated page are not coverage losses.
  const zero = control("/parts/FORD/F250/", 0);
  expect(
    IisModelRoute.coverage(
      [{ make: make("/parts/FORD", 3), models: [zero, ordinary] }],
      [page(zero, 0), page(ordinary, 3)],
      NONE,
    ),
  ).toEqual({
    ok: true,
    value: {
      advertised: 3,
      unreachable: [],
      unreachableCount: 0,
      warnings: [],
    },
  });
});

test("IIS coverage fails a badged make whose model directory is explicitly empty", () => {
  const result = IisModelRoute.coverage(
    [{ make: make("/parts/SAAB", 2), models: [] }],
    [],
    NONE,
  );
  expect(result.ok).toBe(false);
  if (!result.ok)
    expect(result.detail).toContain(
      "make /parts/SAAB advertises 2 donors but its model directory is an explicit",
    );
  expect(
    IisModelRoute.coverage(
      [{ make: make("/parts/SAAB", 0), models: [] }],
      [],
      NONE,
    ).ok,
  ).toBe(true);
});

test("IIS coverage counts only host-proven unreachable empties against a 1% cap", () => {
  const dotted = control("/parts/PLYMOUTH/PLYMOUTH_PASS./", 1);
  const paren = control("/parts/CHRYSLER/NEW_YORKER_(FWD)/", 1);
  const proven = new Set([dotted.path, paren.path]);
  const within = control("/parts/FORD/F150/", 198);
  const allowed = IisModelRoute.coverage(
    [{ make: make("/parts/FORD", 200), models: [dotted, paren, within] }],
    [page(dotted, 0), page(paren, 0), page(within, 198)],
    proven,
  );
  expect(allowed.ok).toBe(true);
  if (allowed.ok) {
    expect(allowed.value.unreachableCount).toBe(2);
    expect(allowed.value.advertised).toBe(200);
    expect(allowed.value.warnings).toEqual([
      "2/200 advertised model donors sit on routes proven unreachable on this host (PLYMOUTH_PASS.: 1 [/parts/PLYMOUTH/PLYMOUTH_PASS./], NEW_YORKER_(FWD): 1 [/parts/CHRYSLER/NEW_YORKER_(FWD)/]); the maximum is 1%.",
    ]);
  }
  const over = control("/parts/FORD/F150/", 197);
  const blocked = IisModelRoute.coverage(
    [{ make: make("/parts/FORD", 199), models: [dotted, paren, over] }],
    [page(dotted, 0), page(paren, 0), page(over, 197)],
    proven,
  );
  expect(blocked.ok).toBe(false);
  if (!blocked.ok)
    expect(blocked.detail).toContain(
      "2/199 advertised model donors sit on routes proven unreachable on this host",
    );
});

test("IIS coverage fails a badged empty on a dotted or parenthesized route the host lists donors on", () => {
  // Pratt lists 4 donors on each of these literal routes (November 13 census),
  // so an empty page there means donors were missed, whatever the spelling.
  for (const path of [
    "/parts/GMC/SAFARI_(GMC)/",
    "/parts/CHEVROLET/BLAZER.JIMMY_(FULL_SIZE)/",
  ]) {
    const model = control(path, 4);
    const filler = control("/parts/FORD/FOCUS/", 1000);
    const result = IisModelRoute.coverage(
      [{ make: make("/parts/X", 1004), models: [model, filler] }],
      [page(model, 0), page(filler, 1000)],
      NONE,
    );
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.detail).toContain(
        `model ${path} advertises 4 donors but ${path} returned an explicit "No Results Found" page`,
      );
  }
});
