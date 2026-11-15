import { expect, test } from "bun:test";
import { urgiisDetailSeller } from "./urgiis-detail";
import { UrgiisTenant } from "./urgiis-tenant";
import { urgiisTasks, type UrgiisEntry } from "./urgiis-traversal";

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
const expected = { stock: "23C012", year: "2015" };
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
  const tasks = urgiisTasks(
    [
      ...prefix,
      {
        ...receipt,
        kind: "model",
        url: tenant.origin + model.path,
        records: [record],
      },
    ],
    tenant,
  );
  expect(tasks.at(-1)).toEqual({
    kind: "detail",
    url: tenant.origin + "/parts/HONDA/ACCORD/23C012/2015",
    stock: "23C012",
    year: "2015",
  });
});
