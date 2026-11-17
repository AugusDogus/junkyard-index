import { brotliDecompressSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { urgiisModelRoute } from "./urgiis-model-route";
import type { UrgiisTenant } from "./urgiis-tenant";

const coverageProbes = z
  .object({
    responses: z.array(
      z.object({ url: z.string(), status: z.number(), html: z.string() }),
    ),
  })
  .parse(
    JSON.parse(
      brotliDecompressSync(
        readFileSync(
          new URL(
            "./urgiis-test-fixtures/coverage-route-probes.json.br",
            import.meta.url,
          ),
        ),
      ).toString(),
    ),
  );

/** Verified substitutes for two tenants' broken model routes, plus Eagle's retry.
 * This evidence helper is offline only; the provider never imports it. */
export function urgiisCoverageProbe(tenant: UrgiisTenant, url: string) {
  const path = new URL(url).pathname;
  const requestPath = urgiisModelRoute(path, tenant).requestPath;
  if (
    requestPath === path &&
    !(tenant.code === "eagle" && path === "/parts/VOLKSWAGEN/ATLAS/")
  )
    return undefined;
  const requestUrl = tenant.origin + requestPath;
  const response = coverageProbes.responses.find(
    (p) => p.url === requestUrl && p.status === 200,
  );
  if (!response)
    throw new Error("Missing qualified model route capture: " + requestUrl);
  return response;
}

// Offline qualification evidence, never imported by the production connector.
export function urgiisEquinoxProbe() {
  const probes = z
    .object({
      responses: z.array(
        z.object({
          tenant: z.string(),
          url: z.string(),
          status: z.number(),
          html: z.string(),
        }),
      ),
    })
    .parse(
      JSON.parse(
        brotliDecompressSync(
          readFileSync(
            new URL(
              "./urgiis-test-fixtures/model-route-probes.json.br",
              import.meta.url,
            ),
          ),
        ).toString(),
      ),
    );
  const response = probes.responses.find(
    (p) =>
      p.tenant === "revolution" &&
      p.url === "https://revolutionautoparts.com/parts/CHEVROLET/EQUINOX/" &&
      p.status === 200,
  );
  if (!response)
    throw new Error("Missing saved Revolution Equinox retry evidence");
  return response;
}
