import { z } from "zod";
import {
  DDAUTO_APP_ID,
  DDAUTO_TABLE,
  DDAUTO_TABLE_ID,
} from "./ddauto-yard-metadata";

const tableName = z.object({
  name: z.literal(DDAUTO_TABLE),
  isSpecial: z.literal(false),
});
const fieldContract = [
  ["Mp2MG", "Year", "number"],
  ["hWp9i", "Make", "string"],
  ["JlJgo", "Model", "string"],
  ["cnfEv", "VIN", "string"],
  ["3cf4t", "Status", "string"],
  ["jWUbL", "Make Single/Make", "string"],
  ["nWiGd", "TOT Count", "number"],
  ["0i78o", "PART Count", "number"],
  ["O7OdI", "PREM COUNT", "number"],
  ["3mHdV", "ALL PART Count", "number"],
  ["M0XG2", "HOLD&KILLED Count", "number"],
] as const;
const columnSchema = z.object({
  name: z.string(),
  displayName: z.string().optional(),
  type: z.object({ kind: z.string() }),
  isUserSpecific: z.boolean(),
  isProtected: z.boolean(),
  fromNativeTable: z.boolean(),
});
const nativeTableSchema = z.object({
  name: tableName,
  sheetName: z.literal("Parts List hotmail"),
  rowIDColumn: z.literal("$rowID"),
  emailOwnersColumn: z.array(z.unknown()).max(0),
  sourceMetadata: z.object({
    type: z.literal("Native table"),
    id: z.literal(DDAUTO_TABLE_ID),
    tableName,
    needsQuery: z.literal(false),
  }),
  columns: z.array(z.unknown()).max(100),
});

export function parseDdautoSnapshot(raw: string) {
  const data = z
    .object({
      appID: z.literal(DDAUTO_APP_ID),
      schema: z.object({ tables: z.array(z.unknown()).min(1).max(100) }),
      publishedAppSnapshot: z.string().max(3_000),
    })
    .parse(JSON.parse(raw));
  const tables = data.schema.tables.filter(
    (value) => z.object({ name: tableName }).safeParse(value).success,
  );
  if (tables.length !== 1)
    throw new Error("DD Auto public native table is missing or ambiguous");
  const table = nativeTableSchema.parse(tables[0]);
  for (const [name, displayName, kind] of fieldContract) {
    const columns = table.columns.filter(
      (value) => z.object({ name: z.literal(name) }).safeParse(value).success,
    );
    const column = columnSchema.parse(columns[0]);
    if (
      columns.length !== 1 ||
      column.displayName !== displayName ||
      column.type.kind !== kind ||
      column.isUserSpecific ||
      column.isProtected ||
      !column.fromNativeTable
    )
      throw new Error(
        "DD Auto native field contract changed for " + displayName,
      );
  }
  const colorColumns = table.columns.filter(
    (value) => z.object({ name: z.literal("FYX7j") }).safeParse(value).success,
  );
  const color = columnSchema.safeParse(colorColumns[0]);
  const colorColumn: "FYX7j" | null =
    colorColumns.length === 1 &&
    color.success &&
    color.data.displayName === "Color" &&
    color.data.type.kind === "string" &&
    !color.data.isUserSpecific &&
    !color.data.isProtected &&
    color.data.fromNativeTable
      ? "FYX7j"
      : null;
  const url = URL.parse(data.publishedAppSnapshot);
  if (
    !url ||
    url.origin !== "https://storage.googleapis.com" ||
    url.pathname !==
      "/glide-prod.appspot.com/published-apps/" + DDAUTO_APP_ID + ".jzon" ||
    url.username ||
    url.password ||
    !/^#PublishedAt=\d{13}$/.test(url.hash)
  )
    throw new Error("DD Auto published-app snapshot destination changed");
  return {
    colorColumn,
    publishedUrl: url.origin + url.pathname + url.search,
    publishedAt: Number(url.hash.slice("#PublishedAt=".length)),
    signature: JSON.stringify(table) + url.hash,
  };
}

/** Revalidate the native public view, table binding and availability semantics. */
export function parseDdautoPublishedApp(raw: string, publishedAt: number) {
  const data = z
    .object({
      publishedAt: z.literal(publishedAt),
      app: z.object({
        title: z.literal("DD Auto Parts Cars"),
        authentication: z.object({ kind: z.literal("disabled") }),
        screenDescriptions: z.record(z.unknown()),
        tabs: z.array(
          z.object({
            title: z.string(),
            hidden: z.boolean(),
            screenName: z.object({
              kind: z.literal("screen"),
              value: z.string(),
            }),
          }),
        ),
      }),
    })
    .parse(JSON.parse(raw));
  if (
    !data.app.tabs.some(
      (tab) =>
        tab.title === "All Vehicle List" &&
        !tab.hidden &&
        tab.screenName.value === "free-5",
    )
  )
    throw new Error("DD Auto complete public inventory tab changed");
  const view = z
    .object({
      type: z.object({ kind: z.literal("table-ref"), tableName }),
      transforms: z.array(z.unknown()).max(0),
      components: z.array(z.unknown()).min(1).max(30),
    })
    .parse(data.app.screenDescriptions["free-5"]);
  const lists = view.components.filter(
    (value) =>
      z.object({ kind: z.literal("inline-list") }).safeParse(value).success,
  );
  if (lists.length !== 1)
    throw new Error("DD Auto all-vehicle table is missing or ambiguous");
  z.object({
    propertyName: z.object({ kind: z.literal("table"), value: tableName }),
    format: z.object({
      kind: z.literal("enum"),
      value: z.literal("super-table"),
    }),
    transforms: z.tuple([
      z.object({
        kind: z.literal("limit"),
        numRows: z.object({ kind: z.literal("number"), value: z.literal(300) }),
      }),
    ]),
  }).parse(lists[0]);
  const detail = z
    .object({ components: z.array(z.unknown()).max(100) })
    .parse(data.app.screenDescriptions["class-" + DDAUTO_TABLE]);
  const statements = detail.components.flatMap((value) => {
    const parsed = z
      .object({
        kind: z.literal("text"),
        text: z.object({ kind: z.literal("string"), value: z.string() }),
      })
      .safeParse(value);
    return parsed.success ? [parsed.data.text.value] : [];
  });
  if (
    !statements.some(
      (text) =>
        text.includes(
          "PARTS = VEHICLE IS IN OUR PARTS YARD AND IS AVAILABLE TO BUY PARTS FROM",
        ) &&
        text.includes("PREMIUM LOT = VEHICLE IS IN A SEPARATE LOT.") &&
        text.includes("KILLED = VEHICLE IS IN THE PROCESS TO BE CRUSHED") &&
        text.includes("NOT AVAILABLE = VEHICLE IS NOT YET AVAILABLE."),
    )
  )
    throw new Error("DD Auto main-yard active status legend changed");
}
