import type { DdautoRecord } from "./ddauto-transform";
import {
  DDAUTO_APP_ID,
  DDAUTO_APP_ORIGIN,
  DDAUTO_DOCUMENT_ROOT,
  DDAUTO_TABLE,
  DDAUTO_TABLE_ID,
  DDAUTO_YARD,
} from "./ddauto-yard-metadata";

export const ddautoTestRecord: DdautoRecord = {
  id: "07gUGpPf7QxFEWyREQXE",
  rowId: "a.B7sofKhSOec6qXgZZLgzw",
  year: "2007",
  make: "Audi",
  model: "A4",
  color: "Black",
  vin: "WAUDF78E47A079344",
  status: "Parts",
};
export const ddautoTestOwner = `<html><body>DD Auto &amp; Salvage
1976 West 200 North, Logan UT 84321 (435) 787-1204
Click the link below to view our current and upcoming parts cars inventory!
<a href="${DDAUTO_APP_ORIGIN}">Parts Cars Inventory</a>
<script type="application/json" id="wix-viewer-model">${JSON.stringify({
  siteFeaturesConfigs: {
    seo: {
      context: {
        businesLocationsDescription: "1976 W 200 N, Logan, UT 84321, USA",
        businessLocationCoordinates: {
          latitude: DDAUTO_YARD.lat,
          longitude: DDAUTO_YARD.lng,
        },
      },
    },
  },
})}</script></body></html>`;
const publishedAt = 1781021574647;
const tableName = { name: DDAUTO_TABLE, isSpecial: false };
export const ddautoTestPublishedUrl =
  "https://storage.googleapis.com/glide-prod.appspot.com/published-apps/" +
  DDAUTO_APP_ID +
  ".jzon#PublishedAt=" +
  publishedAt;
const columns = [
  ["Mp2MG", "Year", "number"],
  ["hWp9i", "Make", "string"],
  ["JlJgo", "Model", "string"],
  ["FYX7j", "Color", "string"],
  ["cnfEv", "VIN", "string"],
  ["3cf4t", "Status", "string"],
  ["jWUbL", "Make Single/Make", "string"],
  ["nWiGd", "TOT Count", "number"],
  ["0i78o", "PART Count", "number"],
  ["O7OdI", "PREM COUNT", "number"],
  ["3mHdV", "ALL PART Count", "number"],
  ["M0XG2", "HOLD&KILLED Count", "number"],
].map(([name, displayName, kind]) => ({
  name,
  displayName,
  type: { kind },
  isUserSpecific: false,
  isProtected: false,
  fromNativeTable: true,
}));
const ddautoTestSnapshotData = {
  appID: DDAUTO_APP_ID,
  schema: {
    tables: [
      {
        name: tableName,
        sheetName: "Parts List hotmail",
        rowIDColumn: "$rowID",
        emailOwnersColumn: [],
        sourceMetadata: {
          type: "Native table",
          id: DDAUTO_TABLE_ID,
          tableName,
          needsQuery: false,
        },
        columns,
      },
    ],
  },
  publishedAppSnapshot: ddautoTestPublishedUrl,
};
export const ddautoTestSnapshot = JSON.stringify(ddautoTestSnapshotData);
export function ddautoTestSnapshotWithColor(column: unknown): string {
  const replacementColumns: unknown[] = columns.filter(
    (value) => value.name !== "FYX7j",
  );
  if (column !== null) replacementColumns.push(column);
  return JSON.stringify({
    ...ddautoTestSnapshotData,
    schema: {
      tables: ddautoTestSnapshotData.schema.tables.map((table) => ({
        ...table,
        columns: replacementColumns,
      })),
    },
  });
}
export const ddautoTestPublished = JSON.stringify({
  publishedAt,
  app: {
    title: "DD Auto Parts Cars",
    authentication: { kind: "disabled" },
    tabs: [
      {
        title: "All Vehicle List",
        hidden: false,
        screenName: { kind: "screen", value: "free-5" },
      },
    ],
    screenDescriptions: {
      "free-5": {
        type: { kind: "table-ref", tableName },
        transforms: [],
        components: [
          {
            kind: "inline-list",
            propertyName: { kind: "table", value: tableName },
            format: { kind: "enum", value: "super-table" },
            transforms: [
              { kind: "limit", numRows: { kind: "number", value: 300 } },
            ],
          },
        ],
      },
      ["class-" + DDAUTO_TABLE]: {
        components: [
          {
            kind: "text",
            text: {
              kind: "string",
              value:
                "PARTS = VEHICLE IS IN OUR PARTS YARD AND IS AVAILABLE TO BUY PARTS FROM\n" +
                "PREMIUM LOT = VEHICLE IS IN A SEPARATE LOT.\n" +
                "KILLED = VEHICLE IS IN THE PROCESS TO BE CRUSHED\n" +
                "NOT AVAILABLE = VEHICLE IS NOT YET AVAILABLE.",
            },
          },
        ],
      },
    },
  },
});

function counts(records: readonly DdautoRecord[]) {
  const parts = records.filter((r) => r.status === "Parts").length;
  const premium = records.filter((r) => r.status === "Premium Lot").length;
  return {
    nWiGd: records.length,
    "0i78o": parts,
    O7OdI: premium,
    "3mHdV": parts + premium,
    M0XG2: records.length - parts - premium,
  };
}
/** Mirrors the captured Firestore wire envelope, including independent directory rows. */
export function ddautoTestRows(
  records: readonly DdautoRecord[] = [ddautoTestRecord],
): string {
  const donors = records.map((r) => ({
    Mp2MG: r.year,
    hWp9i: r.make,
    JlJgo: r.model,
    cnfEv: r.vin,
    FYX7j: r.color,
    "3cf4t": r.status,
  }));
  const controls = [...new Set(records.map((r) => r.make))].map((make) => ({
    jWUbL: make,
    ...counts(records.filter((r) => r.make === make)),
  }));
  const rows = [...donors, ...controls, { jWUbL: "Total", ...counts(records) }];
  return JSON.stringify(
    rows.map((fields, i) => ({
      document: {
        name: DDAUTO_DOCUMENT_ROOT + "/rows/" + String(i).padStart(20, "0"),
        fields: Object.fromEntries(
          Object.entries({
            ...fields,
            $rowID: "row-" + i,
            $rowIndex: "X" + i,
            $rowVersion: 5476,
          }).map(([key, value]) => [
            key,
            typeof value === "number"
              ? { integerValue: String(value) }
              : { stringValue: value },
          ]),
        ),
        createTime: "2026-11-06T22:35:50.000000Z",
        updateTime: "2026-11-06T22:35:50.000000Z",
      },
      readTime: "2026-11-12T05:19:49.515828Z",
    })),
  );
}

export function ddautoTestRecords(count: number): DdautoRecord[] {
  return Array.from({ length: count }, (_, i) => ({
    ...ddautoTestRecord,
    vin: "1N6AA06A04N" + String(8000 + i).padStart(6, "0"),
  }));
}
