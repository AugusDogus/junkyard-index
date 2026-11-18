import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { INGESTION_SOURCES } from "./ingestion-source";
import { YardService } from "./yard-service";
import {
  ARIO_CUSTOMER_YARDS,
  arioLocationCode,
} from "~/server/ingestion/autorecycler-ario-yards";
import { HOLLANDERSTORES_YARDS } from "~/server/ingestion/hollanderstores-yard-metadata";
import { VINPLUS_TENANTS } from "~/server/ingestion/vinplus-configuration";
import { URGIIS_TENANTS } from "~/server/ingestion/urgiis-configuration";
import { UrgiisTenant } from "~/server/ingestion/urgiis-tenant";
import * as tapSites from "~/server/ingestion/tap-sites";
import { PULLNSAVE_YARDS } from "~/server/ingestion/pullnsave-config";
import { GOPULLIT_LOCATIONS } from "~/server/ingestion/gopullit-transform";
import { RTP_YARDS } from "~/server/ingestion/rtp-yard-metadata";
import { NVPAP_YARDS } from "~/server/ingestion/nvpap-yard-metadata";
import {
  HagermanYard,
  HAGERMAN_COORDINATES,
} from "~/server/ingestion/hagerman-yard-metadata";

const evidence = await Bun.file(
  new URL(
    "../../docs/runbooks/yard-service-classification.md",
    import.meta.url,
  ),
).text();
const rowSchema = z.object({
  source: z.enum(INGESTION_SOURCES),
  code: z.string().min(1),
  kind: z.enum(["self_service", "full_service", "both", "unknown"]),
  evidence: z.string().min(1),
  confidence: z.enum(["high", "medium", "low"]),
});
const census = evidence
  .split("\n")
  .filter((line) =>
    /^\|\s*`[^`]+`\s*\|\s*`[^`]+`[^|]*\|\s*`(self_service|full_service|both|unknown)`\s*\|/.test(
      line,
    ),
  )
  .map((line) => {
    const [, source, yard, kind, reference, confidence] = line
      .split("|")
      .map((cell) => cell.trim());
    return rowSchema.parse({
      source: source?.replaceAll("`", ""),
      code: /^`([^`]+)`/.exec(yard ?? "")?.[1],
      kind: kind?.replaceAll("`", ""),
      evidence: reference,
      confidence,
    });
  });

const unknownSchema = rowSchema
  .pick({ source: true, code: true })
  .extend({ reason: z.string().min(1) });
const unknownYards =
  (evidence.split("## Unknown yards")[1] ?? "")
    .split("### Unreviewed location policy")[0]
    ?.split("\n")
    .filter((line) => /^\|\s*`[^`]+`\s*\|\s*`[^`]+`/.test(line))
    .map((line) => {
      const [, source, yard, reason] = line
        .split("|")
        .map((cell) => cell.trim());
      return unknownSchema.parse({
        source: source?.replaceAll("`", ""),
        code: /^`([^`]+)`/.exec(yard ?? "")?.[1],
        reason,
      });
    }) ?? [];

const configuredYardSchema = rowSchema
  .pick({ source: true, code: true })
  .extend({ city: z.string() });
const objectSchema = z.record(z.unknown());

function configuredYards(
  value: unknown,
): z.infer<typeof configuredYardSchema>[] {
  const yard = configuredYardSchema.safeParse(value);
  if (yard.success) return [yard.data];
  if (Array.isArray(value))
    return value.flatMap((item: unknown) => configuredYards(item));
  const object = objectSchema.safeParse(value);
  return object.success
    ? Object.values(object.data).flatMap(configuredYards)
    : [];
}

describe("YardService", () => {
  test("the evidence census covers every registered source without duplicate yards", () => {
    expect(new Set(census.map((yard) => yard.source))).toEqual(
      new Set(INGESTION_SOURCES),
    );
    expect(
      new Set(census.map((yard) => `${yard.source}:${yard.code}`)).size,
    ).toBe(census.length);
  });

  test("every census yard resolves to its evidenced classification", () => {
    for (const yard of census) {
      const service = YardService.resolve(yard.source, yard.code);
      expect(service.kind, `${yard.source}/${yard.code}`).toBe(yard.kind);
      if (service.kind === "unknown") {
        expect(service.reason.length).toBeGreaterThan(0);
        expect(evidence.split("## Unknown yards")[1]).toContain(service.reason);
      }
    }
  });

  test("unknown is reserved for yards with an individually recorded reason", () => {
    expect(
      new Set(unknownYards.map((yard) => `${yard.source}:${yard.code}`)),
    ).toEqual(
      new Set(
        census
          .filter((yard) => yard.kind === "unknown")
          .map((yard) => `${yard.source}:${yard.code}`),
      ),
    );
    for (const yard of unknownYards) {
      const row = census.find(
        (row) => row.source === yard.source && row.code === yard.code,
      );
      expect(row?.evidence).toContain(yard.reason);
      expect(row?.confidence).toBe("low");
    }
  });

  test("all configured tenants of mixed providers have a census entry", () => {
    const configured = [
      ...HOLLANDERSTORES_YARDS,
      ...VINPLUS_TENANTS.map((tenant) => tenant.yard),
      ...URGIIS_TENANTS.flatMap(UrgiisTenant.yards),
      ...ARIO_CUSTOMER_YARDS.map((yard) => ({
        source: "autorecycler",
        code: arioLocationCode(yard),
      })),
    ];
    for (const yard of configured) {
      expect(
        census.some(
          (row) => row.source === yard.source && row.code === yard.code,
        ),
        `${yard.source}/${yard.code}`,
      ).toBe(true);
    }
  });

  test("all statically configured yards appear in the census", async () => {
    const directory = new URL("../server/ingestion/", import.meta.url);
    const configured = [
      HagermanYard.create(HAGERMAN_COORDINATES),
      ...Object.values(tapSites).flatMap((site) =>
        Object.values(site.storeLocations).map((yard) => ({
          source: site.source,
          code: yard.code,
        })),
      ),
      ...PULLNSAVE_YARDS.map((yard) => ({
        source: "pullnsave",
        code: yard.code,
      })),
      ...GOPULLIT_LOCATIONS.map((yard) => ({
        source: "gopullit",
        code: yard.code,
      })),
      ...Object.keys(RTP_YARDS).map((code) => ({ source: "rtp", code })),
      ...Object.keys(NVPAP_YARDS).map((code) => ({ source: "nvpap", code })),
    ];
    for await (const filename of new Bun.Glob("*.ts").scan({
      cwd: directory.pathname,
    })) {
      if (!/(-yard-metadata|-configuration|-yards)\.ts$/.test(filename))
        continue;
      const exports: unknown = await import(new URL(filename, directory).href);
      configured.push(...configuredYards(exports));
    }
    for (const yard of configured) {
      expect(
        census.some(
          (row) => row.source === yard.source && row.code === yard.code,
        ),
        `${yard.source}/${yard.code}`,
      ).toBe(true);
    }
  });

  test("active legacy AutoRecycler yards appear with their preserved identifiers", async () => {
    const legacy = z
      .object({ docs: z.array(z.object({ _id: z.string() })) })
      .parse(
        await Bun.file(
          new URL(
            "../server/ingestion/fixtures/ario/legacy-active-orgs.json",
            import.meta.url,
          ),
        ).json(),
      );
    for (const yard of legacy.docs) {
      expect(
        census.some(
          (row) =>
            row.source === "autorecycler" &&
            row.code === `1348695171700984260__LOOKUP__${yard._id}`,
        ),
      ).toBe(true);
    }
  });

  test("every admitted heavy-truck seller is full-service", () => {
    for (const yard of census.filter((row) =>
      ["heavytruckparts", "bigtruckpage", "vanderhaags"].includes(row.source),
    )) {
      expect(YardService.resolve(yard.source, yard.code)).toEqual({
        kind: "full_service",
      });
    }
  });

  test("chain defaults also cover newly discovered chain locations", () => {
    expect(YardService.resolve("pyp", "new-location")).toEqual({
      kind: "self_service",
    });
    expect(YardService.resolve("heavytruckparts", "new-supplier")).toEqual({
      kind: "full_service",
    });
    expect(YardService.resolve("ipullupull", "new-location")).toEqual({
      kind: "both",
    });
  });

  test("unreviewed mixed-provider yards stay unknown with a documented reason", () => {
    for (const source of [
      "row52",
      "autorecycler",
      "hollanderstores",
      "vinplus",
      "urgiis",
    ] as const) {
      const service = YardService.resolve(source, "unreviewed-yard");
      expect(service.kind).toBe("unknown");
      if (service.kind === "unknown")
        expect(evidence).toContain(service.reason);
    }
  });

  test("service follows the ingested physical yard rather than neighboring businesses", () => {
    expect(YardService.resolve("sandw", "lithonia-upull")).toEqual({
      kind: "self_service",
    });
    expect(YardService.resolve("grandpajohns", "WI25")).toEqual({
      kind: "self_service",
    });
    expect(YardService.resolve("idipull", "idaho-falls")).toEqual({
      kind: "self_service",
    });
    expect(YardService.resolve("kodak", "strawberry-plains")).toEqual({
      kind: "full_service",
    });
    expect(YardService.resolve("pickapartva", "TT87")).toEqual({
      kind: "both",
    });
    expect(YardService.resolve("hollanderstores", "paulsouin")).toEqual({
      kind: "self_service",
    });
    expect(YardService.resolve("hollanderstores", "nwaupiautoparts")).toEqual({
      kind: "both",
    });
  });
});
