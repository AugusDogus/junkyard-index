import { relations, sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" })
    .default(false)
    .notNull(),
  image: text("image"),
  // Discord integration fields
  discordId: text("discord_id"),
  discordAppInstalled: integer("discord_app_installed", { mode: "boolean" })
    .default(false)
    .notNull(),
  locationPreferenceMode: text("location_preference_mode"),
  locationZipCode: text("location_zip_code"),
  locationLat: real("location_lat"),
  locationLng: real("location_lng"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
});

export const session = sqliteTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [index("session_userId_idx").on(table.userId)],
);

export const account = sqliteTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: integer("access_token_expires_at", {
      mode: "timestamp_ms",
    }),
    refreshTokenExpiresAt: integer("refresh_token_expires_at", {
      mode: "timestamp_ms",
    }),
    scope: text("scope"),
    password: text("password"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("account_userId_idx").on(table.userId)],
);

export const verification = sqliteTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, {
    fields: [session.userId],
    references: [user.id],
  }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, {
    fields: [account.userId],
    references: [user.id],
  }),
}));

// Saved searches table
export const savedSearch = sqliteTable(
  "saved_search",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    query: text("query").notNull(),
    filters: text("filters").notNull(),
    emailAlertsEnabled: integer("email_alerts_enabled", { mode: "boolean" })
      .default(false)
      .notNull(),
    discordAlertsEnabled: integer("discord_alerts_enabled", { mode: "boolean" })
      .default(false)
      .notNull(),
    lastCheckedAt: integer("last_checked_at", { mode: "timestamp_ms" }),
    // Processing lock to prevent race conditions between cron job and webhooks
    processingLock: integer("processing_lock", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("saved_search_userId_idx").on(table.userId),
    index("saved_search_emailAlertsEnabled_idx").on(table.emailAlertsEnabled),
    index("saved_search_discordAlertsEnabled_idx").on(
      table.discordAlertsEnabled,
    ),
  ],
);

export const savedSearchRelations = relations(savedSearch, ({ one }) => ({
  user: one(user, {
    fields: [savedSearch.userId],
    references: [user.id],
  }),
}));

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
  savedSearches: many(savedSearch),
}));

// ── Ingestion Pipeline Tables ───────────────────────────────────────────────

export const vehicle = sqliteTable(
  "vehicle",
  {
    vin: text("vin").primaryKey(),
    source: text("source").notNull(), // "pyp" | "row52" | "autorecycler"
    year: integer("year").notNull(),
    make: text("make").notNull(),
    model: text("model").notNull(),
    color: text("color"),
    stockNumber: text("stock_number"),
    imageUrl: text("image_url"),
    availableDate: text("available_date"),
    locationCode: text("location_code").notNull(),
    locationName: text("location_name").notNull(),
    locationCity: text("location_city").default("Unknown").notNull(),
    state: text("state").notNull(),
    stateAbbr: text("state_abbr").notNull(),
    lat: real("lat").notNull(),
    lng: real("lng").notNull(),
    section: text("section"),
    row: text("row"),
    space: text("space"),
    detailsUrl: text("details_url"),
    partsUrl: text("parts_url"),
    pricesUrl: text("prices_url"),
    engine: text("engine"),
    trim: text("trim"),
    transmission: text("transmission"),
    firstSeenAt: integer("first_seen_at", { mode: "timestamp_ms" }).notNull(),
    lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" }).notNull(),
    missingSinceAt: integer("missing_since_at", { mode: "timestamp_ms" }),
    missingRunCount: integer("missing_run_count"),
  },
  (table) => [
    index("vehicle_source_idx").on(table.source),
    index("vehicle_make_model_idx").on(table.make, table.model),
    index("vehicle_first_seen_at_idx").on(table.firstSeenAt),
    index("vehicle_last_seen_at_idx").on(table.lastSeenAt),
    index("vehicle_missing_since_at_idx").on(table.missingSinceAt),
    index("vehicle_missing_run_count_idx").on(table.missingRunCount),
    index("vehicle_location_code_idx").on(table.locationCode),
    index("vehicle_state_abbr_idx").on(table.stateAbbr),
  ],
);

export const ingestionRun = sqliteTable("ingestion_run", {
  id: text("id").primaryKey(),
  source: text("source").notNull(), // "pyp" | "row52" | "all"
  status: text("status").notNull(), // "running" | "success" | "error"
  vehiclesUpserted: integer("vehicles_upserted").default(0),
  vehiclesDeleted: integer("vehicles_deleted").default(0),
  errors: text("errors"), // JSON array of error strings
  startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
  completedAt: integer("completed_at", { mode: "timestamp_ms" }),
});

export const ingestionSourceRun = sqliteTable(
  "ingestion_source_run",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => ingestionRun.id, { onDelete: "cascade" }),
    source: text("source").notNull(), // "pyp" | "row52" | "autorecycler"
    status: text("status").notNull(), // "running" | "success" | "error" | "partial"
    startCursor: text("start_cursor"),
    nextCursor: text("next_cursor"),
    pagesProcessed: integer("pages_processed").default(0).notNull(),
    vehiclesProcessed: integer("vehicles_processed").default(0).notNull(),
    errors: text("errors"), // JSON array of error strings
    startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
    completedAt: integer("completed_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    index("ingestion_source_run_run_id_idx").on(table.runId),
    index("ingestion_source_run_source_idx").on(table.source),
    index("ingestion_source_run_status_idx").on(table.status),
  ],
);

export const vehicleSnapshot = sqliteTable(
  "vehicle_snapshot",
  {
    runId: text("run_id")
      .notNull()
      .references(() => ingestionRun.id, { onDelete: "cascade" }),
    source: text("source").notNull(), // "pyp" | "row52" | "autorecycler"
    vin: text("vin").notNull(),
    year: integer("year").notNull(),
    make: text("make").notNull(),
    model: text("model").notNull(),
    color: text("color"),
    stockNumber: text("stock_number"),
    imageUrl: text("image_url"),
    availableDate: text("available_date"),
    locationCode: text("location_code").notNull(),
    locationName: text("location_name").notNull(),
    locationCity: text("location_city").default("Unknown").notNull(),
    state: text("state").notNull(),
    stateAbbr: text("state_abbr").notNull(),
    lat: real("lat").notNull(),
    lng: real("lng").notNull(),
    section: text("section"),
    row: text("row"),
    space: text("space"),
    detailsUrl: text("details_url"),
    partsUrl: text("parts_url"),
    pricesUrl: text("prices_url"),
    engine: text("engine"),
    trim: text("trim"),
    transmission: text("transmission"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.runId, table.source, table.vin],
    }),
    index("vehicle_snapshot_run_source_idx").on(table.runId, table.source),
    index("vehicle_snapshot_vin_idx").on(table.vin),
  ],
);

export const vehicleChange = sqliteTable(
  "vehicle_change",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    runId: text("run_id")
      .notNull()
      .references(() => ingestionRun.id, { onDelete: "cascade" }),
    vin: text("vin").notNull(),
    changeType: text("change_type").notNull(), // "upsert" | "missing" | "delete"
    payload: text("payload"),
    payloadVersion: integer("payload_version").default(1).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    processedAt: integer("processed_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    index("vehicle_change_run_id_idx").on(table.runId),
    index("vehicle_change_vin_idx").on(table.vin),
    index("vehicle_change_processed_at_idx").on(table.processedAt, table.id),
  ],
);

export const ingestionProjectorCheckpoint = sqliteTable(
  "ingestion_projector_checkpoint",
  {
    name: text("name").primaryKey(),
    lastProcessedChangeId: integer("last_processed_change_id")
      .default(0)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => new Date())
      .notNull(),
  },
);

/** Cached yard geolocation resolved from AutoRecycler `init/data` (details pages). */
export const autorecyclerOrgGeo = sqliteTable(
  "autorecycler_org_geo",
  {
    orgLookup: text("org_lookup").primaryKey(),
    lat: real("lat").notNull(),
    lng: real("lng").notNull(),
    locationName: text("location_name").notNull(),
    locationCity: text("location_city").default("Unknown").notNull(),
    state: text("state").notNull(),
    stateAbbr: text("state_abbr").notNull(),
    address: text("address"),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("autorecycler_org_geo_updated_at_idx").on(table.updatedAt)],
);
