import { expect, test } from "bun:test";
import {
  parseCaltonDirectory,
  parseCaltonPage,
  type CaltonResult,
} from "./calton-parser";
import { CaltonRecord, type CaltonContext } from "./calton-record";
import { caltonContinuations } from "./calton-html";
import {
  CALTON_ARRIVALS_FIXTURE,
  CALTON_MAKES_FIXTURE,
  CALTON_MODELS_FIXTURE,
  CALTON_TLX_FIXTURE,
  CALTON_AUDI_CARD,
  CALTON_PHOTO_CARD,
  CALTON_EMPTY_REGION,
  caltonFixtureDocument,
} from "./calton-test-fixtures";

function value<T>(result: CaltonResult<T>): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}
const makes = () =>
  value(
    parseCaltonDirectory(CALTON_MAKES_FIXTURE, {
      kind: "makes",
      sourceUrl: "https://caltonautoparts.com/parts/",
    }),
  );
function modelContext(): CaltonContext {
  const make = makes().controls.find((control) => control.label === "ACURA");
  if (!make) throw new Error("Missing saved Acura control");
  const model = value(
    parseCaltonDirectory(CALTON_MODELS_FIXTURE, {
      kind: "models",
      sourceUrl: "https://caltonautoparts.com/parts/ACURA",
      make,
    }),
  ).controls.find((control) => control.label === "TLX");
  if (!model) throw new Error("Missing saved TLX control");
  return {
    kind: "model",
    sourceUrl: "https://caltonautoparts.com/parts/ACURA/TLX",
    make,
    model,
  };
}
const assess = (html = CALTON_TLX_FIXTURE) =>
  value(parseCaltonPage(html, modelContext())).records.map((record) =>
    CaltonRecord.assess(
      record,
      makes().controls.map((control) => control.label),
    ),
  );

test("saved make and model menus preserve every literal control and count", () => {
  const directory = makes();
  expect(directory.controls).toHaveLength(47);
  expect(
    directory.controls.reduce((sum, control) => sum + control.count, 0),
  ).toBe(12846);
  const context = modelContext();
  if (context.kind !== "model") throw new Error("Expected model context");
  const models = value(
    parseCaltonDirectory(CALTON_MODELS_FIXTURE, {
      kind: "models",
      sourceUrl: context.make.literal,
      make: context.make,
    }),
  );
  expect(models.controls).toHaveLength(15);
  expect(models.controls.reduce((sum, control) => sum + control.count, 0)).toBe(
    382,
  );
  expect(context.make).toMatchObject({
    path: "/parts/ACURA",
    label: "ACURA",
    count: 382,
  });
  expect(context.model).toMatchObject({
    path: "/parts/ACURA/TLX",
    label: "TLX",
    count: 8,
  });
});

test("all eight native premium donors are retained and assessed independently", () => {
  const page = value(parseCaltonPage(CALTON_TLX_FIXTURE, modelContext()));
  expect(page.records).toHaveLength(8);
  expect(page.countCheck).toEqual({
    kind: "matches",
    advertised: 8,
    observed: 8,
  });
  expect(assess().every((record) => record.status === "required-pass")).toBe(
    true,
  );
  expect(assess()[0]?.candidate).toMatchObject({
    vin: "19UUB2F50HA004048",
    year: 2017,
    make: "ACURA",
    model: "TLX",
    stockNumber: "L11007",
    imageUrl: null,
    availableDate: null,
    color: null,
    row: null,
  });
});

test("the nine homepage arrivals are an unbound subset with native dates", () => {
  const page = value(
    parseCaltonPage(CALTON_ARRIVALS_FIXTURE, {
      kind: "arrivals",
      sourceUrl: "https://caltonautoparts.com:443/",
    }),
  );
  expect(page.records).toHaveLength(9);
  expect(page.countCheck).toEqual({ kind: "unbound" });
  const results = page.records.map((record) =>
    CaltonRecord.assess(
      record,
      makes().controls.map((control) => control.label),
    ),
  );
  expect(results.every((record) => record.status === "required-pass")).toBe(
    true,
  );
  expect(results[0]?.candidate).toMatchObject({
    vin: "1GCDM19W6TB151288",
    availableDate: "2026-11-09",
    imageUrl: null,
  });
});

test("missing or malformed VINs reject their row without dropping other donors or repairing identity", () => {
  for (const vin of ["", "19UUB2F5OHA004048"]) {
    const records = assess(
      CALTON_TLX_FIXTURE.replace("19UUB2F50HA004048", vin),
    );
    expect(records).toHaveLength(8);
    expect(records[0]?.status).toBe("required-reject");
    expect(records[0]?.candidate).toBeNull();
    expect(
      records.slice(1).every((record) => record.status === "required-pass"),
    ).toBe(true);
  }
});

test("conflicting native required claims remain visible", () => {
  const records = assess(
    CALTON_TLX_FIXTURE.replace(
      "VIN: 19UUB2F50HA004048</p>",
      'VIN: 19UUB2F50HA004048</p><p class="aps-la-subtitle-premium--vin">VIN: 19UUB1F54HA006783</p>',
    ),
  );
  expect(records[0]?.status).toBe("identity-conflict");
  expect(records[0]?.record.vins).toEqual([
    "19UUB2F50HA004048",
    "19UUB1F54HA006783",
  ]);
});

test("foreign destinations are retained and never rewritten onto the owner", () => {
  const record = assess(
    CALTON_TLX_FIXTURE.replace(
      'href="https://caltonautoparts.com/parts/ACURA/TLX/L11007/2017"',
      'href="https://foreign.example/parts/ACURA/TLX/L11007/2017"',
    ),
  )[0];
  expect(record?.status).toBe("boundary-unknown");
  expect(record?.record.destinations[0]?.literal).toBe(
    "https://foreign.example/parts/ACURA/TLX/L11007/2017",
  );
  expect(record?.candidate).toBeNull();
});

test("destination year and stock contradictions fail identity", () => {
  for (const replacement of [
    "/ACURA/TLX/L11007/2016",
    "/ACURA/TLX/OTHER/2017",
  ]) {
    expect(
      assess(
        CALTON_TLX_FIXTURE.replaceAll("/ACURA/TLX/L11007/2017", replacement),
      )[0]?.status,
    ).toBe("identity-conflict");
  }
});

test("optional missing images and stock do not erase native required identities", () => {
  const html = CALTON_TLX_FIXTURE.replace(/<img\b[^>]*>/g, "").replace(
    '<div class="aps-la-stat-value">L11007</div>',
    '<div class="aps-la-stat-value"></div>',
  );
  expect(assess(html)[0]?.candidate).toMatchObject({
    vin: "19UUB2F50HA004048",
    stockNumber: null,
    imageUrl: null,
  });
});

test("malformed ownership, canonical, document and donor boundaries return structured failures", () => {
  for (const html of [
    CALTON_TLX_FIXTURE.replace("'MM28'", "'OTHER'"),
    CALTON_TLX_FIXTURE.replace(
      'rel="canonical" href="https://caltonautoparts.com',
      'rel="canonical" href="https://foreign.example',
    ),
    CALTON_TLX_FIXTURE.replace("</body></html>", ""),
    CALTON_TLX_FIXTURE.replace("aps-la-card-link-premium", "changed-card-link"),
    CALTON_TLX_FIXTURE.replace(
      '<div id="L11007" class="aps-la-card-premium">',
      '<article id="L11007" class="aps-la-card-premium">',
    ),
  ])
    expect(parseCaltonPage(html, modelContext()).ok).toBe(false);
  expect(
    parseCaltonPage(CALTON_TLX_FIXTURE, {
      ...modelContext(),
      sourceUrl: "https://foreign.example/parts/ACURA/TLX",
    }).ok,
  ).toBe(false);
});

test("every menu anchor is checked, including changed classes, duplicate paths and foreign parents", () => {
  for (const html of [
    CALTON_MAKES_FIXTURE.replace('/parts/ACURA"', '/parts/ACURA?offset=1"'),
    CALTON_MAKES_FIXTURE.replace(
      'href="https://caltonautoparts.com/parts/ACURA"',
      'href="https://foreign.example/parts/ACURA"',
    ),
    CALTON_MAKES_FIXTURE.replace(">382</span>", ">many</span>"),
    CALTON_MAKES_FIXTURE.replace('/parts/AUDI"', '/parts/ACURA"'),
  ])
    expect(
      parseCaltonDirectory(html, {
        kind: "makes",
        sourceUrl: "https://caltonautoparts.com/parts/",
      }).ok,
    ).toBe(false);
});

test("continuations and count discrepancies preserve rows without asserting completeness", () => {
  const context = modelContext();
  if (context.kind !== "model") throw new Error("Expected model context");
  const page = value(
    parseCaltonPage(
      CALTON_TLX_FIXTURE.replace(
        '<div class="aps-la-grid">',
        '<a rel="next" href="?page=2">Next</a><div class="aps-la-grid">',
      ),
      { ...context, model: { ...context.model, count: 9 } },
    ),
  );
  expect(page.records).toHaveLength(8);
  expect(page.continuationControls).toHaveLength(1);
  expect(page.continuationControls[0]).toContain("?page=2");
  expect(page.countCheck).toEqual({
    kind: "mismatch",
    advertised: 9,
    observed: 8,
  });
});

test("absence of donor cards is an unresolved protocol, never an invented empty inventory", () => {
  expect(parseCaltonPage(CALTON_MODELS_FIXTURE, modelContext()).ok).toBe(false);
});

test("unread continuation controls outside the inventory region remain visible", () => {
  const outside = (html: string) =>
    html.replace("</body>", '<a rel="next" href="?page=2">Next</a></body>');
  const directory = value(
    parseCaltonDirectory(outside(CALTON_MAKES_FIXTURE), {
      kind: "makes",
      sourceUrl: "https://caltonautoparts.com/parts/",
    }),
  );
  expect(directory.continuationControls).toHaveLength(1);
  const page = value(
    parseCaltonPage(outside(CALTON_TLX_FIXTURE), modelContext()),
  );
  expect(page.continuationControls).toHaveLength(1);
});

test("observed photo carousels and Elementor slides do not hide real continuations", () => {
  const photo =
    '<button class="carousel-control-next aps-gallery-carousel-control" data-bs-target="#apsLaGalleryCarousel" data-bs-slide="next">Next</button>';
  const slides =
    '<div class="elementor-pagination-position-inside elementor-widget-slides" data-widget_type="slides.default"></div>';
  expect(caltonContinuations(photo + slides)).toEqual([]);
  expect(
    caltonContinuations(photo.replace("#apsLaGalleryCarousel", "#inventory")),
  ).toHaveLength(1);
  expect(
    caltonContinuations(slides.replace("slides.default", "inventory.default")),
  ).toHaveLength(1);
  expect(
    caltonContinuations(
      slides.replace(
        "data-widget_type",
        'data-next-cursor="abc" data-widget_type',
      ),
    ),
  ).toHaveLength(1);
  expect(
    caltonContinuations(
      photo.replace("data-bs-slide", 'data-next-page="2" data-bs-slide'),
    ).length,
  ).toBeGreaterThan(0);
});

test("published redundant model labels remain distinct from literal route tokens", () => {
  const page = value(
    parseCaltonPage(
      caltonFixtureDocument(
        `<div id="iiscont"><div class="aps-la-grid">${CALTON_AUDI_CARD}</div></div>`,
        "/parts/AUDI/AUDI_A3",
      ),
      {
        kind: "model",
        sourceUrl: "https://caltonautoparts.com/parts/AUDI/AUDI_A3",
        make: {
          path: "/parts/AUDI",
          literal: "https://caltonautoparts.com/parts/AUDI",
          label: "AUDI",
          count: 1,
        },
        model: {
          path: "/parts/AUDI/AUDI_A3",
          literal: "https://caltonautoparts.com/parts/AUDI/AUDI_A3",
          label: "AUDI A3",
          count: 1,
        },
      },
    ),
  );
  expect(
    CaltonRecord.assess(
      page.records[0] ??
        (() => {
          throw new Error("Missing card");
        })(),
      ["AUDI"],
    ).candidate,
  ).toMatchObject({ make: "AUDI", model: "A3" });
  expect(page.records[0]?.titles).toEqual(["AUDI A3"]);
});

test("observed explicit no-results preserves the advertised count disagreement", () => {
  const path = "/parts/CHEVROLET/CHEVROLET_PASS.";
  const page = value(
    parseCaltonPage(caltonFixtureDocument(CALTON_EMPTY_REGION, path), {
      kind: "model",
      sourceUrl: "https://caltonautoparts.com" + path,
      make: {
        path: "/parts/CHEVROLET",
        literal: "https://caltonautoparts.com/parts/CHEVROLET",
        label: "CHEVROLET",
        count: 1,
      },
      model: {
        path,
        literal: "https://caltonautoparts.com" + path,
        label: "CHEVROLET PASS. 1",
        count: 1,
      },
    }),
  );
  expect(page.records).toEqual([]);
  expect(page.nativeEmptyResult).toBe(
    "No Results.. Try Browsing Our Parts Or Search Again",
  );
  expect(page.countCheck).toEqual({
    kind: "mismatch",
    advertised: 1,
    observed: 0,
  });
});

test("the saved MM28 donor photograph remains optional metadata", () => {
  const path = "/parts/ACURA/ILX";
  const page = value(
    parseCaltonPage(
      caltonFixtureDocument(
        `<div id="iiscont">${CALTON_PHOTO_CARD}</div>`,
        path,
      ),
      {
        kind: "model",
        sourceUrl: "https://caltonautoparts.com" + path,
        make: {
          path: "/parts/ACURA",
          literal: "https://caltonautoparts.com/parts/ACURA",
          label: "ACURA",
          count: 1,
        },
        model: {
          path,
          literal: "https://caltonautoparts.com" + path,
          label: "ILX",
          count: 1,
        },
      },
    ),
  );
  const record = page.records[0];
  if (!record) throw new Error("Missing photo donor");
  expect(CaltonRecord.assess(record, ["ACURA"]).candidate?.imageUrl).toBe(
    "https://da8h1v3w8q6n5.cloudfront.net/mm28/images/H02034/H02034_1.jpg",
  );
});

test("foreign literal parent controls cannot be reconstructed into owned paths", () => {
  const context = modelContext();
  if (context.kind !== "model") throw new Error("Expected model context");
  expect(
    parseCaltonPage(CALTON_TLX_FIXTURE, {
      ...context,
      model: {
        ...context.model,
        literal: "https://foreign.example/parts/ACURA/TLX",
      },
    }).ok,
  ).toBe(false);
  expect(
    parseCaltonDirectory(CALTON_MODELS_FIXTURE, {
      kind: "models",
      sourceUrl: context.make.literal,
      make: { ...context.make, literal: "https://foreign.example/parts/ACURA" },
    }).ok,
  ).toBe(false);
});

test("malformed optional dates remain null and raw rows are never coalesced", () => {
  const malformed = CALTON_ARRIVALS_FIXTURE.replaceAll(
    "2026-11-09",
    "2026-99-99",
  );
  const page = value(
    parseCaltonPage(malformed, {
      kind: "arrivals",
      sourceUrl: "https://caltonautoparts.com/",
    }),
  );
  expect(
    CaltonRecord.assess(
      page.records[0] ??
        (() => {
          throw new Error("Missing arrival");
        })(),
      makes().controls.map((control) => control.label),
    ).candidate?.availableDate,
  ).toBeNull();
  const duplicated = caltonFixtureDocument(
    `<div id="iiscont">${CALTON_AUDI_CARD}${CALTON_AUDI_CARD}</div>`,
    "/parts/AUDI/AUDI_A3",
  );
  const record = value(
    parseCaltonPage(duplicated, {
      kind: "model",
      sourceUrl: "https://caltonautoparts.com/parts/AUDI/AUDI_A3",
      make: {
        path: "/parts/AUDI",
        literal: "https://caltonautoparts.com/parts/AUDI",
        label: "AUDI",
        count: 1,
      },
      model: {
        path: "/parts/AUDI/AUDI_A3",
        literal: "https://caltonautoparts.com/parts/AUDI/AUDI_A3",
        label: "AUDI A3",
        count: 1,
      },
    }),
  );
  expect(record.records).toHaveLength(2);
  expect(record.countCheck).toEqual({
    kind: "mismatch",
    advertised: 1,
    observed: 2,
  });
});

test("raw destination spellings cannot be normalized past ownership validation", () => {
  const raw = String.raw`https:\\caltonautoparts.com\parts\ACURA\TLX\L11007\2017`;
  const result = assess(
    CALTON_TLX_FIXTURE.replace(
      'href="https://caltonautoparts.com/parts/ACURA/TLX/L11007/2017"',
      `href="${raw}"`,
    ),
  )[0];
  expect(result?.status).toBe("boundary-unknown");
  expect(result?.record.destinations[0]?.literal).toBe(raw);
});

test("query context never replaces contradictory native title fields", () => {
  const context = modelContext();
  if (context.kind !== "model") throw new Error("Expected model context");
  const page = value(
    parseCaltonPage(CALTON_TLX_FIXTURE, {
      ...context,
      model: { ...context.model, label: "DIFFERENT" },
    }),
  );
  const record = page.records[0];
  if (!record) throw new Error("Missing saved donor");
  expect(record.titles).toEqual(["ACURA TLX"]);
  expect(CaltonRecord.assess(record, ["ACURA"]).status).toBe(
    "identity-conflict",
  );
  expect(
    assess(CALTON_TLX_FIXTURE.replace(">Year</span>", ">Price</span>"))[0]
      ?.status,
  ).toBe("required-reject");
});
