import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { brotliDecompressSync } from "node:zlib";
import { z } from "zod";
import { URGIIS_TENANTS } from "./urgiis-configuration";
import { urgiisCarry } from "./urgiis-census";
import { urgiisDetailPresence, urgiisDetailSeller } from "./urgiis-detail";
import { UrgiisTenant } from "./urgiis-tenant";
import {
  UrgiisEntrySchema,
  urgiisTasks,
  type UrgiisEntry,
} from "./urgiis-traversal";

const yard = {
  source: "urgiis",
  code: "ringoes",
  name: "Lentini Ringoes",
  operator: "Lentini",
  address: "130 US-202",
  city: "Ringoes",
  state: "NJ",
  postalCode: "08551",
  lat: 40.47,
  lng: -74.86,
  phone: null,
  email: null,
  websiteUrl: "https://example.com/",
} as const;
const tenant: UrgiisTenant = {
  code: "lentini",
  origin: "https://example.com",
  urgid: "NJ12,II08",
  pathStyle: "parts",
  makesPath: "/parts/makes/",
  arrivalsPath: "/recent-arrivals/",
  ownerPath: "/",
  ownerClaims: ["Lentini"],
  cookie: null,
  pacingMs: 2200,
  requestTimeoutMs: 40_000,
  minimumInventory: 2,
  photoCodes: ["nj12"],
  skipBlankVin: false,
  placeholderStocks: [],
  yard,
  attribution: {
    kind: "seller",
    additionalYards: [{ ...yard, code: "port-murray" }],
    sellerYards: { NJ12: "ringoes", II08: "port-murray" },
    minimumByYard: { ringoes: 1, "port-murray": 1 },
  },
};
const expected = {
  stock: "23C012",
  year: "2015",
  vin: "1HGCR2F36FA076065",
};
const document = (body: string) =>
  `<html><body><script>var urgid='NJ12,II08';</script><input name="stockno" value="23C012"><input name="yearin" value="2015">${body}</body></html>`;

test("URG IIS assigns multi-yard donors from agreeing native seller and SKU evidence", () => {
  const raw = document(
    '<input name="sellingurgid" value="II08"><li class="iis-lisku">SKU: II081234</li>',
  );
  expect(urgiisDetailSeller(raw, tenant, expected)).toBe("II08");
  expect(UrgiisTenant.yardForSeller(tenant, "II08")?.code).toBe("port-murray");
  expect(
    urgiisDetailSeller(raw.replace("II081234", "NJ121234"), tenant, expected),
  ).toBeNull();
  expect(
    urgiisDetailSeller(
      raw
        .replace('value="II08"', 'value="OTHER"')
        .replace("II081234", "OTHER1234"),
      tenant,
      expected,
    ),
  ).toBeNull();
  expect(
    urgiisDetailSeller(document("No Results"), tenant, expected),
  ).toBeNull();
  expect(UrgiisTenant.yardForSeller(tenant, null)).toBeNull();
  expect(
    urgiisDetailSeller(raw, tenant, { ...expected, year: "2017" }),
  ).toBeNull();
  expect(
    urgiisDetailSeller(raw, tenant, { ...expected, stock: "OTHER" }),
  ).toBeNull();
  expect(
    urgiisDetailSeller(
      raw.replace('<li class="iis-lisku">SKU: II081234</li>', ""),
      tenant,
      expected,
    ),
  ).toBeNull();
});

test("URG IIS rejects seller evidence with a contradictory native part VIN", () => {
  const body =
    '<input name="sellingurgid" value="II08"><li class="iis-lisku">SKU: II081234</li>';
  const claim = (vin: string) =>
    `<li class="iispartpagevin"><strong>VIN: </strong>${vin}</li>`;
  expect(
    urgiisDetailSeller(document(body + claim(expected.vin)), tenant, expected),
  ).toBe("II08");
  expect(
    urgiisDetailSeller(
      document(body + claim("4T1C11BK9MU029294")),
      tenant,
      expected,
    ),
  ).toBeNull();
  expect(
    urgiisDetailSeller(
      document(body + claim(expected.vin) + claim("4T1C11BK9MU029294")),
      tenant,
      expected,
    ),
  ).toBeNull();
});

test("URG IIS derives detail tasks only from a completed native model frontier", () => {
  const make = { path: "/parts/HONDA", label: "HONDA", count: 1 };
  const model = { path: "/parts/HONDA/ACCORD/", label: "ACCORD", count: 1 };
  const receipt = { bytes: 1 };
  const prefix = [
    { ...receipt, kind: "owner", url: tenant.origin + "/", identity: "owner" },
    {
      ...receipt,
      kind: "makes",
      url: tenant.origin + tenant.makesPath,
      controls: [make],
    },
    {
      ...receipt,
      kind: "arrivals",
      url: tenant.origin + tenant.arrivalsPath,
      records: [],
    },
    {
      ...receipt,
      kind: "menu",
      url: tenant.origin + make.path,
      controls: [model],
    },
  ] satisfies UrgiisEntry[];
  expect(urgiisTasks(prefix, tenant).map((t) => t.kind)).toEqual([
    "owner",
    "makes",
    "arrivals",
    "menu",
    "model",
  ]);
  const record = {
    years: ["2015"],
    titles: ["HONDA ACCORD"],
    vins: ["1HGCR2F36FA076065"],
    inquiries: [],
    destinations: [tenant.origin + "/parts/HONDA/ACCORD/23C012/2015"],
    stock: "23C012",
    image: null,
    date: null,
  };
  const entries = [
    ...prefix,
    {
      ...receipt,
      kind: "model",
      freshness: { kind: "read", readAt: 0 },
      url: tenant.origin + model.path,
      records: [record],
    },
  ].map((entry) => UrgiisEntrySchema.parse(entry));
  const tasks = urgiisTasks(entries, tenant);
  expect(urgiisTasks(entries, tenant)).toBe(tasks);
  expect(Object.isFrozen(tasks)).toBe(true);
  const changed = entries.map((e) =>
    e.kind === "model" ? UrgiisEntrySchema.parse({ ...e, records: [] }) : e,
  );
  expect(urgiisTasks(changed, tenant).some((t) => t.kind === "detail")).toBe(
    false,
  );
  expect(urgiisTasks(entries, { ...tenant, minimumInventory: 3 })).not.toBe(
    tasks,
  );
  expect(tasks.at(-1)).toEqual({
    kind: "detail",
    url: tenant.origin + "/parts/HONDA/ACCORD/23C012/2015",
    stock: "23C012",
    year: "2015",
    vin: "1HGCR2F36FA076065",
  });
});

describe("URG IIS seller detail reuse", () => {
  const day = 24 * 60 * 60 * 1000;
  const acceptedAt = Date.UTC(2026, 10, 20, 7);
  const make = { path: "/parts/HONDA", label: "HONDA", count: 1 };
  const model = { path: "/parts/HONDA/ACCORD/", label: "ACCORD", count: 1 };
  const url = tenant.origin + "/parts/HONDA/ACCORD/23C012/2015";
  const record = {
    years: ["2015"],
    titles: ["HONDA ACCORD"],
    vins: ["1HGCR2F36FA076065"],
    inquiries: [],
    destinations: [url],
    stock: "23C012",
    image: null,
    date: null,
  };
  const entries = (options: {
    model?: "read" | "carried" | "none";
    readAt: number;
    vin?: string;
    // A second card for the same detail URL, after the donor's card.
    otherVin?: string;
    seller?: string | null;
    detail?: boolean;
  }): UrgiisEntry[] => {
    const donor = { ...record, vins: [options.vin ?? record.vins[0] ?? ""] };
    const list: unknown[] = [
      { bytes: 1, kind: "owner", url: tenant.origin + "/", identity: "o" },
      {
        bytes: 1,
        kind: "makes",
        url: tenant.origin + tenant.makesPath,
        controls: [make],
      },
      {
        bytes: 1,
        kind: "arrivals",
        url: tenant.origin + tenant.arrivalsPath,
        records: options.model === "none" ? [donor] : [],
      },
      {
        bytes: 1,
        kind: "menu",
        url: tenant.origin + make.path,
        controls: [model],
      },
      {
        bytes: options.model === "carried" ? 0 : 1,
        kind: "model",
        url: tenant.origin + model.path,
        records:
          options.model === "none"
            ? []
            : [
                donor,
                ...(options.otherVin
                  ? [{ ...record, vins: [options.otherVin] }]
                  : []),
              ],
        freshness: {
          kind: options.model === "carried" ? "carried" : "read",
          readAt: options.readAt,
        },
      },
      ...(options.detail === false
        ? []
        : [
            {
              bytes: 1,
              kind: "detail",
              url,
              seller: options.seller === undefined ? "NJ12" : options.seller,
              readAt: options.readAt,
            },
          ]),
    ];
    return list.map((entry) => UrgiisEntrySchema.parse(entry));
  };
  const previous = (options: Parameters<typeof entries>[0]) => ({
    code: tenant.code,
    scope: "fixture",
    acceptedAt,
    entries: entries(options),
  });
  const reuse = (
    before: Parameters<typeof entries>[0],
    today: Omit<Parameters<typeof entries>[0], "detail">,
    age: number,
  ) => {
    const current = entries({ ...today, detail: false });
    const task = urgiisTasks(current, tenant).at(-1);
    if (task?.kind !== "detail") throw new Error("Expected a seller task");
    return urgiisCarry(task, current, previous(before), acceptedAt + age);
  };

  test("a freshly read model reuses an unchanged donor's seller instead of refetching it", () => {
    expect(
      reuse({ readAt: acceptedAt }, { readAt: acceptedAt + 6 * day }, 6 * day),
    ).toEqual({
      kind: "detail",
      url,
      bytes: 0,
      seller: "NJ12",
      readAt: acceptedAt,
    });
  });

  test("a freshly read model refreshes a seller 21 days old", () => {
    expect(
      reuse(
        { readAt: acceptedAt },
        { readAt: acceptedAt + 21 * day },
        21 * day,
      ),
    ).toBeUndefined();
  });

  test("a carried model reuses its seller until 27 days, then refreshes it", () => {
    const today = { model: "carried" as const, readAt: acceptedAt };
    expect(reuse({ readAt: acceptedAt }, today, 26 * day)?.bytes).toBe(0);
    expect(reuse({ readAt: acceptedAt }, today, 27 * day)).toBeUndefined();
  });

  test("a changed VIN at the same stock and year refetches the seller", () => {
    expect(
      reuse(
        { readAt: acceptedAt, vin: "1HGCR2F36FA000000" },
        { readAt: acceptedAt + day },
        day,
      ),
    ).toBeUndefined();
  });

  test("a seller checked against another card at the same URL is refetched", () => {
    // The previous detail task kept the last card's VIN, so its seller was
    // never checked against today's donor.
    expect(
      reuse(
        { readAt: acceptedAt, otherVin: "1HGCR2F36FA000000" },
        { readAt: acceptedAt + day },
        day,
      ),
    ).toBeUndefined();
  });

  test("an unattributed detail is reused only inside a carried model", () => {
    const before = { readAt: acceptedAt, seller: null };
    expect(reuse(before, { readAt: acceptedAt + day }, day)).toBeUndefined();
    expect(
      reuse(before, { model: "carried", readAt: acceptedAt }, day),
    ).toMatchObject({ kind: "detail", seller: null });
    expect(
      reuse({ ...before, model: "none" }, { model: "none", readAt: 0 }, day),
    ).toBeUndefined();
  });

  test("an arrivals-only donor reuses its seller", () => {
    expect(
      reuse(
        { model: "none", readAt: acceptedAt },
        { model: "none", readAt: acceptedAt + day },
        day,
      ),
    ).toMatchObject({ kind: "detail", seller: "NJ12" });
  });
});

describe("a car's detail page shows whether it is still listed", () => {
  // Norb's pages captured November 27, 2026 under the URG gate.
  const norbs = URGIIS_TENANTS.find((t) => t.code === "norbs");
  if (!norbs) throw new Error("Missing Norb's qualification");
  const captures = new Map(
    z
      .array(z.object({ url: z.string(), html: z.string() }).passthrough())
      .parse(
        JSON.parse(
          brotliDecompressSync(
            readFileSync(
              new URL(
                "./urgiis-test-fixtures/norbs-detail-probes.json.br",
                import.meta.url,
              ),
            ),
          ).toString(),
        ),
      )
      .map((c) => [new URL(c.url).pathname, c.html] as const),
  );
  const page = (path: string) => {
    const html = captures.get(path);
    if (!html) throw new Error("Missing capture " + path);
    return html;
  };
  const f150 = "/parts/FORD/FORD_F150_PICKUP/P21590/2020";
  const car = { stock: "P21590", year: "2020", vins: ["1FTEX1CB9LKE09739"] };

  test("part rows for the expected stock, year and VIN keep the car", () => {
    expect(urgiisDetailPresence(page(f150), norbs, car)).toBe("listed");
    // A card without a VIN claim is kept on its stock and year.
    expect(
      urgiisDetailPresence(page(f150), norbs, { ...car, vins: [""] }),
    ).toBe("listed");
  });

  test("the native no-results message marks a sold or unknown car gone", () => {
    expect(
      urgiisDetailPresence(page("/parts/BUICK/LUCERNE/P21967/2006"), norbs, {
        stock: "P21967",
        year: "2006",
        vins: [""],
      }),
    ).toBe("gone");
    expect(
      urgiisDetailPresence(
        page("/parts/FORD/FORD_F150_PICKUP/Z99999/2010"),
        norbs,
        { stock: "Z99999", year: "2010", vins: [] },
      ),
    ).toBe("gone");
  });

  test("another car's rows, a timed-out model template or a truncated page are not evidence", () => {
    for (const expected of [
      { ...car, stock: "P21591" },
      { ...car, year: "2019" },
      { ...car, vins: ["1FTEW1EP0KKE06920"] },
    ])
      expect(() => urgiisDetailPresence(page(f150), norbs, expected)).toThrow(
        "expected stock",
      );
    expect(() =>
      urgiisDetailPresence(page("/parts/FORD/FORD_F150_PICKUP/"), norbs, car),
    ).toThrow("neither part rows nor its native no-results message");
    // A render the origin cut off after its part rows.
    const cut = page(f150).replace(/<\/body>\s*<\/html>[\s\S]*$/i, "");
    expect(() => urgiisDetailPresence(cut, norbs, car)).toThrow("truncated");
  });
});
