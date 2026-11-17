import { brotliDecompressSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { z } from "zod";

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
