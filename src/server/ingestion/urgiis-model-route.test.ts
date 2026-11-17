import { expect, spyOn, test } from "bun:test";
import { Effect } from "effect";
import { URGIIS_TENANTS } from "./urgiis-configuration";
import { urgiisModelRoute } from "./urgiis-model-route";
import { urgiisCoverageProbe } from "./urgiis-route-probe";
import { readUrgiisPage } from "./urgiis-client";
import { iisCards } from "./urgiis-catalog";
import { urgiisSnapshot } from "./urgiis-snapshot";

for (const code of ["ace-st-paul", "norbs"]) {
  test(`${code} substitutes one verified raw-ampersand request and admits native donor links`, async () => {
    const tenant = URGIIS_TENANTS.find((t) => t.code === code);
    if (!tenant) throw new Error("Missing qualified tenant");
    const model = {
      path: "/parts/CHRYSLER/TOWN_-and_COUNTRY/",
      label: "TOWN & COUNTRY",
      count: code === "norbs" ? 75 : 54,
    };
    const url = tenant.origin + model.path;
    const probe = urgiisCoverageProbe(tenant, url);
    if (!probe) throw new Error("Missing route evidence");
    const response = new Response(probe.html, {
      headers: { "content-type": "text/html" },
    });
    Object.defineProperty(response, "url", { value: probe.url });
    const request = spyOn(globalThis, "fetch").mockResolvedValue(response);
    try {
      const raw = await Effect.runPromise(
        readUrgiisPage(url, { ...tenant, pacingMs: 1 }),
      );
      expect(request).toHaveBeenCalledTimes(1);
      expect(request.mock.calls[0]?.[0]).toBe(
        tenant.origin + "/parts/CHRYSLER/TOWN_&_COUNTRY/",
      );
      const records = iisCards(raw, tenant).records;
      expect(records).toHaveLength(model.count);
      const make = {
        path: "/parts/CHRYSLER",
        label: "CHRYSLER",
        count: model.count,
      };
      const snapshot = urgiisSnapshot(
        [{ make, model, records, hash: "" }],
        tenant,
      );
      expect(snapshot.vehicles.length).toBeGreaterThan(0);
      expect(
        snapshot.vehicles.every((v) =>
          v.detailsUrl?.includes("/TOWN_and__COUNTRY/"),
        ),
      ).toBe(true);
      // The published menu path stays intact; no other donor destination is authorized.
      expect(model.path).toBe("/parts/CHRYSLER/TOWN_-and_COUNTRY/");
      const conflicting = records.map((r) => ({
        ...r,
        destinations: r.destinations.map((d) =>
          d.replace("TOWN_and__COUNTRY", "VOYAGER"),
        ),
      }));
      expect(
        urgiisSnapshot(
          [{ make, model, records: conflicting, hash: "" }],
          tenant,
        ).vehicles,
      ).toHaveLength(0);
      expect(
        urgiisSnapshot([{ make, model, records, hash: "" }], {
          ...tenant,
          modelEncoding: undefined,
        }).vehicles,
      ).toHaveLength(0);
    } finally {
      request.mockRestore();
    }
  });
}

test("URG route translation is confined to the qualified model segment", () => {
  const tenant = URGIIS_TENANTS.find((t) => t.code === "norbs");
  if (!tenant) throw new Error("Missing Norb's");
  const path = "/parts/MAKE_-and_X/MODEL_-and_X/STOCK_-and_X/2005";
  expect(urgiisModelRoute(path, tenant)).toEqual({
    requestPath: "/parts/MAKE_-and_X/MODEL_&_X/STOCK_-and_X/2005",
    donorPath: "/parts/MAKE_-and_X/MODEL_and__X/STOCK_-and_X/2005",
  });
  expect(
    urgiisModelRoute(path, { ...tenant, modelEncoding: undefined }),
  ).toEqual({ requestPath: path, donorPath: path });
});
