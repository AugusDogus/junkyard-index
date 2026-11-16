import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { brotliDecompressSync } from "node:zlib";
import { createHash } from "node:crypto";
import { z } from "zod";
import { iisCards, iisDirectory, iisDocument } from "./urgiis-catalog";
import { iisAttribute, iisContinuation, iisRegion, iisText } from "./iis-html";
import { URGIIS_TENANTS } from "./urgiis-configuration";

const lines = brotliDecompressSync(
  readFileSync(
    new URL(
      "./urgiis-test-fixtures/batch-c-excluded.jsonl.br",
      import.meta.url,
    ),
  ),
)
  .toString()
  .trim()
  .split("\n");
const metadata = z
  .object({
    failures: z.array(
      z.object({
        code: z.string(),
        site: z.object({
          origin: z.string().url(),
          urgid: z.string(),
          pathStyle: z.enum(["parts", "used-parts"]),
        }),
        requests: z.array(
          z.object({
            url: z.string().url(),
            status: z.number().optional(),
            exit: z.number().optional(),
            attempt: z.number().optional(),
          }),
        ),
      }),
    ),
    responseCount: z.number(),
  })
  .parse(JSON.parse(lines[0] ?? ""));
const responses = lines.slice(1).map((line) =>
  z
    .object({
      tenantCode: z.string(),
      url: z.string().url(),
      html: z.string(),
      status: z.number().optional(),
    })
    .parse(JSON.parse(line)),
);

test("Transwest remains excluded when the 30-card Titan result has no complete alternate route", () => {
  const failure = metadata.failures.find((f) => f.code === "transwest");
  if (!failure) throw new Error("Missing Transwest qualification evidence");
  expect(URGIIS_TENANTS.some((t) => t.code === failure.code)).toBe(false);
  const captured = responses.filter((r) => r.tenantCode === failure.code);
  const page = (path: string) => {
    const response = captured.find((r) => r.url === failure.site.origin + path);
    if (!response) throw new Error("Missing Transwest response: " + path);
    return response.html;
  };
  const make = iisDirectory(page("/parts/makes/"), failure.site).find(
    (m) => m.path === "/parts/NISSAN",
  );
  if (!make) throw new Error("Missing published Nissan make");
  const model = iisDirectory(page(make.path), failure.site, make).find(
    (m) => m.path === "/parts/NISSAN/TITAN/",
  );
  if (!model) throw new Error("Missing published Titan model");
  expect(model.count).toBe(38);
  const html = page(model.path);
  const original = iisCards(html, failure.site);
  expect(original.records).toHaveLength(30);
  expect([
    ...new Set(
      original.records.flatMap(
        (r) => r.image?.match(/cloudfront\.net\/([^/]+)\//)?.[1] ?? [],
      ),
    ),
  ]).toEqual(["ut08"]);
  expect(
    iisContinuation(
      iisRegion(
        iisDocument(html, failure.site),
        (tag) => iisAttribute(tag, "id") === "iiscont",
      ),
    ),
  ).toEqual([]);
  expect(iisCards(page(model.path + "?paged=2"), failure.site).records).toEqual(
    original.records,
  );
  expect(
    failure.requests
      .filter((r) => r.url === failure.site.origin + model.path + "?page=2")
      .map((r) => r.status),
  ).toEqual([404, 404, 404]);
});

test("Lake Point's exact optimized script references retain supplier identity", () => {
  const failure = metadata.failures.find((f) => f.code === "lakepoint");
  if (!failure) throw new Error("Missing Lake Point qualification evidence");
  for (const path of [
    "/",
    "/contact/",
    "/search-inventory/",
    "/parts/makes/",
  ]) {
    const response = responses.find(
      (r) =>
        r.tenantCode === failure.code && r.url === failure.site.origin + path,
    );
    if (!response) throw new Error("Missing official Lake Point page: " + path);
    expect(() => iisDocument(response.html, failure.site)).not.toThrow();
    for (const changed of [
      response.html.replace(
        /\/litespeed\/js\/[a-f0-9]+\.js/g,
        "/litespeed/js/unknown.js",
      ),
      response.html.replaceAll(".js?ver=9a323", ".js?ver=changed"),
      response.html.replace(
        /<script data-optimized="1"[^>]*><\/script>/g,
        "<!--$&-->",
      ),
      response.html.replace(
        "</body>",
        '<script data-optimized="1" src="https://lakepointauto.com/unknown.js"></script></body>',
      ),
      response.html.replace(
        "</body>",
        "<script>var urgid = 'OTHER';</script></body>",
      ),
    ])
      expect(() => iisDocument(changed, failure.site)).toThrow(
        "IIS supplier identity changed: expected UU23",
      );
    expect(() =>
      iisDocument(response.html, {
        ...failure.site,
        origin: "https://other.example",
      }),
    ).toThrow("IIS supplier identity changed");
    expect(() =>
      iisDocument(response.html, { ...failure.site, urgid: "OTHER" }),
    ).toThrow("IIS supplier identity changed");
  }
});

test("Lake Point's allowlisted script hashes declare the native supplier and origin", () => {
  const bundles = z
    .array(z.object({ url: z.string().url(), script: z.string() }))
    .parse(
      JSON.parse(
        brotliDecompressSync(
          readFileSync(
            new URL(
              "./urgiis-test-fixtures/lakepoint-supplier-bundles.json.br",
              import.meta.url,
            ),
          ),
        ).toString(),
      ),
    );
  expect(bundles).toHaveLength(6);
  for (const { url, script } of bundles) {
    const hash = createHash("md5").update(script).digest("hex");
    expect(url).toBe(
      `https://lakepointauto.com/wp-content/litespeed/js/${hash}.js?ver=9a323`,
    );
    const declarations = [
      ...script.matchAll(/\bvar\s+urgid\s*=\s*(['"])(.*?)\1\s*;/g),
    ];
    expect(declarations.length).toBeGreaterThan(0);
    expect(new Set(declarations.map((m) => m[2]))).toEqual(new Set(["UU23"]));
    expect(script).toContain("var iisHomeUrl='lakepointauto.com';");
  }
});

test("A-Z's known arrivals title identifies native parts donors", () => {
  const failure = metadata.failures.find((f) => f.code === "az");
  if (!failure) throw new Error("Missing A-Z qualification evidence");
  const response = responses.find(
    (r) =>
      r.tenantCode === "az" &&
      r.url === failure.site.origin + "/latest-arrivals/",
  );
  if (!response) throw new Error("Missing A-Z native arrivals page");
  expect(iisText(response.html)).toContain("haven't parted them out yet");
  expect(
    iisCards(response.html, failure.site, "arrivals").records,
  ).toHaveLength(60);
});

for (const qualification of [
  {
    code: "az",
    name: "A-Z",
    makes: 27,
    models: 183,
    path: "/parts/KIA/SPORTAGE/",
    attempts: [
      { attempt: 1, status: 0, exit: 28 },
      { attempt: 2, status: 0, exit: 28 },
      { attempt: 3, status: 0, exit: 28 },
    ],
  },
  {
    code: "norbs",
    name: "Norb's",
    makes: 51,
    models: 672,
    path: "/parts/FORD/TAURUS/",
    attempts: [
      { attempt: 1, status: 0, exit: 6 },
      { attempt: 2, status: 0, exit: 6 },
      { attempt: 3, status: 0, exit: 6 },
    ],
  },
  {
    code: "southwest",
    name: "Southwest",
    makes: 45,
    models: 372,
    path: "/parts/MERCURY/GRAND_MARQUIS/",
    attempts: [
      { attempt: 1, status: 500, exit: 0 },
      { attempt: 2, status: 0, exit: 28 },
      { attempt: 3, status: 500, exit: 0 },
    ],
  },
]) {
  test(`${qualification.name}'s initial census stops after bounded model request failures`, () => {
    const failure = metadata.failures.find(
      (f) => f.code === qualification.code,
    );
    if (!failure)
      throw new Error("Missing qualification: " + qualification.code);
    const captured = responses.filter(
      (r) =>
        r.tenantCode === failure.code &&
        (r.status === undefined || r.status === 200),
    );
    const makesPage = captured.find(
      (r) => r.url === failure.site.origin + "/parts/makes/",
    );
    if (!makesPage) throw new Error("Missing makes: " + qualification.code);
    const makes = iisDirectory(makesPage.html, failure.site);
    const models = makes.flatMap((make) => {
      const response = captured.find(
        (r) => r.url === failure.site.origin + make.path,
      );
      if (!response) throw new Error("Missing make: " + make.path);
      return iisDirectory(response.html, failure.site, make);
    });
    expect(makes).toHaveLength(qualification.makes);
    expect(models).toHaveLength(qualification.models);
    expect(models.some((model) => model.path === qualification.path)).toBe(
      true,
    );
    expect(
      failure.requests
        .filter((r) => r.url === failure.site.origin + qualification.path)
        .map(({ attempt, status, exit }) => ({ attempt, status, exit })),
    ).toEqual(qualification.attempts);
    expect(
      captured.some((r) => r.url === failure.site.origin + qualification.path),
    ).toBe(false);
    expect(responses).toHaveLength(metadata.responseCount);
  });
}
