import {
  type AnyColumn,
  and,
  asc,
  eq,
  getTableColumns,
  inArray,
  isNotNull,
  notInArray,
} from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import type { DormantYard } from "~/lib/dormant-yard";
import { HiddenSources } from "~/lib/hidden-source";
import { RETIRED_INGESTION_SOURCES } from "~/lib/ingestion-source";
import { getYardDetails } from "~/lib/yard-details";
import { YardPath } from "~/lib/yard-path";
import { SourceControlRepository } from "~/server/source-control/source-control-repository";
import { departedYard, yardInventory, yard as yardTable } from "~/schema";

type YardRow = {
  source: string;
  code: string;
  name: string;
  city: string;
  state: string;
  lat: number;
  lng: number;
  inventoryUrl: string | null;
  metadata: typeof yardTable.$inferSelect | null;
};

/** The row's yard with its metadata's name, address, website and contacts. */
function detailed({ metadata, inventoryUrl, ...yard }: YardRow) {
  return { ...yard, ...getYardDetails({ ...yard, inventoryUrl }, metadata) };
}

function metadataJoin(source: AnyColumn, code: AnyColumn) {
  return and(eq(yardTable.source, source), eq(yardTable.code, code));
}

/**
 * One row per yard with live vehicles, maintained by ingestion. Every yard
 * listing, yard page and sitemap starts here, so hidden and retired sources
 * are left out once.
 */
export async function getHomepageYards(
  database: LibSQLDatabase,
  hidden: HiddenSources,
) {
  const yards = await database
    .select({
      source: yardInventory.source,
      code: yardInventory.locationCode,
      name: yardInventory.locationName,
      city: yardInventory.locationCity,
      state: yardInventory.stateAbbr,
      lat: yardInventory.lat,
      lng: yardInventory.lng,
      vehicleCount: yardInventory.vehicleCount,
      inventoryUrl: yardInventory.inventoryUrl,
      metadata: getTableColumns(yardTable),
    })
    .from(yardInventory)
    .leftJoin(
      yardTable,
      metadataJoin(yardInventory.source, yardInventory.locationCode),
    )
    .where(
      notInArray(yardInventory.source, [...HiddenSources.unlisted(hidden)]),
    )
    .orderBy(asc(yardInventory.stateAbbr), asc(yardInventory.locationName));
  const withDetails = yards.map(({ vehicleCount, ...row }) => ({
    ...detailed(row),
    vehicleCount,
  }));
  const paths = YardPath.assign(withDetails);
  return withDetails.map((yard) => ({
    ...yard,
    path: paths.get(YardPath.key(yard)) ?? null,
  }));
}

/**
 * Yards that show no vehicles but may keep their page (see DormantYard):
 * those of sources in `hidden` only by the automatic 7-day hide, since their
 * last accepted publication, and those whose last vehicle departed, since
 * then. Yards of retired sources and of sources the owner hid from /admin
 * are left out.
 */
export async function getDormantYardCandidates(
  database: LibSQLDatabase,
  hidden: HiddenSources,
) {
  const ownerHidden = await SourceControlRepository.hiddenSources(database);
  const autoHidden = hidden.list.filter(
    (source) => !HiddenSources.has(ownerHidden, source),
  );
  const [unconfirmed, emptied] = await Promise.all([
    autoHidden.length === 0
      ? []
      : database
          .select({
            source: yardInventory.source,
            code: yardInventory.locationCode,
            name: yardInventory.locationName,
            city: yardInventory.locationCity,
            state: yardInventory.stateAbbr,
            lat: yardInventory.lat,
            lng: yardInventory.lng,
            inventoryUrl: yardInventory.inventoryUrl,
            since: yardInventory.lastPublishedAt,
            metadata: getTableColumns(yardTable),
          })
          .from(yardInventory)
          .leftJoin(
            yardTable,
            metadataJoin(yardInventory.source, yardInventory.locationCode),
          )
          .where(
            and(
              inArray(yardInventory.source, autoHidden),
              isNotNull(yardInventory.lastPublishedAt),
            ),
          ),
    database
      .select({
        source: departedYard.source,
        code: departedYard.locationCode,
        name: departedYard.locationName,
        city: departedYard.locationCity,
        state: departedYard.stateAbbr,
        lat: departedYard.lat,
        lng: departedYard.lng,
        inventoryUrl: departedYard.inventoryUrl,
        since: departedYard.departedAt,
        metadata: getTableColumns(yardTable),
      })
      .from(departedYard)
      .leftJoin(
        yardTable,
        metadataJoin(departedYard.source, departedYard.locationCode),
      )
      .where(
        notInArray(departedYard.source, [
          ...RETIRED_INGESTION_SOURCES,
          ...ownerHidden.list,
        ]),
      ),
  ]);
  const unconfirmedYards = unconfirmed.flatMap(({ since, ...row }) => {
    if (!since) return [];
    const dormant: DormantYard = {
      kind: "unconfirmed",
      since: since.toISOString(),
    };
    return [{ ...detailed(row), vehicleCount: 0, dormant }];
  });
  const emptiedYards = emptied.map(({ since, ...row }) => {
    const dormant: DormantYard = {
      kind: "emptied",
      since: since.toISOString(),
    };
    return { ...detailed(row), vehicleCount: 0, dormant };
  });
  return [...unconfirmedYards, ...emptiedYards];
}
