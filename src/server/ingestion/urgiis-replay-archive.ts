import { createReadStream, existsSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { brotliDecompressSync, createBrotliDecompress } from "node:zlib";
import { z } from "zod";
import { iisCards, iisDirectory } from "./urgiis-catalog";
import { urgiisSnapshot, type UrgiisModelPage } from "./urgiis-snapshot";
import type { UrgiisControl, UrgiisRecord } from "./urgiis-schema";
import type { UrgiisTenant } from "./urgiis-tenant";

const responseSchema = z.object({ url: z.string().url(), html: z.string() });
const metadataSchema = z.object({
  tenantCode: z.string(),
  expected: z.object({
    accepted: z.number(),
    byYard: z.record(z.string(), z.number().int().positive()),
    recordsProcessed: z.number(),
    recordsExcluded: z.number(),
    recordsRejected: z.number(),
    duplicateVehicles: z.number(),
  }),
});
export type UrgiisReplayArchive = z.infer<typeof metadataSchema> & {
  responseCount: number;
  next(): Promise<z.infer<typeof responseSchema> | undefined>;
  close(): void;
};
export const UrgiisReplayArchive = {
  /** Assess all saved observations independently of an earlier traversal failure. */
  async assess(code: string, tenant: UrgiisTenant) {
    const archive = await UrgiisReplayArchive.open(code);
    const makes = new Map<string, UrgiisControl>();
    const models = new Map<
      string,
      { make: UrgiisControl; model: UrgiisControl }
    >();
    const pages: UrgiisModelPage[] = [];
    const arrivals: UrgiisRecord[] = [];
    const seen = new Set<string>();
    try {
      let response;
      while ((response = await archive.next())) {
        if (seen.has(response.url)) continue;
        seen.add(response.url);
        const path = new URL(response.url).pathname;
        if (path === tenant.makesPath)
          for (const make of iisDirectory(response.html, tenant))
            makes.set(make.path, make);
        else if (path === tenant.arrivalsPath)
          arrivals.push(...iisCards(response.html, tenant, "arrivals").records);
        else {
          const make = makes.get(path);
          if (make)
            for (const model of iisDirectory(response.html, tenant, make))
              models.set(model.path, { make, model });
          const model = models.get(path);
          if (model)
            pages.push({
              ...model,
              records: iisCards(response.html, tenant).records,
              hash: "",
            });
        }
      }
      return urgiisSnapshot(pages, tenant, new Map(), arrivals);
    } finally {
      archive.close();
    }
  },
  async open(code: string): Promise<UrgiisReplayArchive> {
    const streamed = new URL(
      `./urgiis-test-fixtures/${code}.jsonl.br`,
      import.meta.url,
    );
    if (!existsSync(streamed)) {
      const archive = metadataSchema
        .extend({ responses: z.array(responseSchema) })
        .parse(
          JSON.parse(
            brotliDecompressSync(
              readFileSync(
                new URL(
                  `./urgiis-test-fixtures/${code}.json.br`,
                  import.meta.url,
                ),
              ),
            ).toString(),
          ),
        );
      let index = 0;
      return {
        tenantCode: archive.tenantCode,
        expected: archive.expected,
        responseCount: archive.responses.length,
        next: () => Promise.resolve(archive.responses[index++]),
        close() {},
      };
    }
    // Large seller-attributed catalogs retain every raw response while decoding
    // only one JSON line at a time instead of a single enormous JSON string.
    const source = createReadStream(streamed);
    const body = source.pipe(createBrotliDecompress());
    source.once("error", (cause: Error) => body.destroy(cause));
    const lines = createInterface({ input: body, crlfDelay: Infinity });
    const iterator = lines[Symbol.asyncIterator]();
    const close = () => {
      lines.close();
      body.destroy();
      source.destroy();
    };
    try {
      const first = await iterator.next();
      if (first.done) throw new Error(`Empty IIS replay archive: ${code}`);
      const metadata = metadataSchema
        .extend({ responseCount: z.number().int().positive() })
        .parse(JSON.parse(first.value));
      return {
        ...metadata,
        async next() {
          const line = await iterator.next();
          return line.done
            ? undefined
            : responseSchema.parse(JSON.parse(line.value));
        },
        close,
      };
    } catch (cause) {
      close();
      throw cause;
    }
  },
};
