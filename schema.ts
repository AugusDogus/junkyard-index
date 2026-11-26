import { relations, sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { FirstSighting } from "./src/lib/first-sighting";
import { YARD_CHECK_OUTCOMES } from "./src/lib/yard-check";

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
  termsAcceptedAt: integer("terms_accepted_at", { mode: "timestamp_ms" }),
  termsVersion: text("terms_version"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
});

export const billingOperation = sqliteTable(
  "billing_operation",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => user.id, { onDelete: "cascade" }),
    state: text("state", {
      enum: [
        "checkout_claimed",
        "checkout_completed",
        "checkout_completed_claimed",
        "checkout_open",
        "deleting",
      ],
    }).notNull(),
    token: text("token"),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    check(
      "billing_operation_state_check",
      sql`(
        (${table.state} in ('checkout_open', 'checkout_completed') and ${table.token} is null)
        or (${table.state} in ('checkout_claimed', 'checkout_completed_claimed', 'deleting')
          and ${table.token} is not null)
      )`,
    ),
  ],
);

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
    searchMatchVersion: integer("search_match_version").default(1).notNull(),
    emailConfigVersion: integer("email_config_version").default(1).notNull(),
    discordConfigVersion: integer("discord_config_version")
      .default(1)
      .notNull(),
    emailStartSequence: integer("email_start_sequence").default(0).notNull(),
    discordStartSequence: integer("discord_start_sequence")
      .default(0)
      .notNull(),
    lastMatchedPublicationSequence: integer("last_matched_publication_sequence")
      .default(0)
      .notNull(),
    lastCheckedAt: integer("last_checked_at", { mode: "timestamp_ms" }),
    alertQuarantinedAt: integer("alert_quarantined_at", {
      mode: "timestamp_ms",
    }),
    alertQuarantineReason: text("alert_quarantine_reason"),
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

// Yard requests submitted by visitors asking us to add a salvage yard
export const yardRequest = sqliteTable(
  "yard_request",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").references(() => user.id, {
      onDelete: "cascade",
    }),
    yardName: text("yard_name").notNull(),
    website: text("website"),
    requesterEmail: text("requester_email"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [index("yard_request_userId_idx").on(table.userId)],
);

export const yardRequestRelations = relations(yardRequest, ({ one }) => ({
  user: one(user, {
    fields: [yardRequest.userId],
    references: [user.id],
  }),
}));

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
  savedSearches: many(savedSearch),
  yardRequests: many(yardRequest),
}));

// ── Ingestion Pipeline Tables ───────────────────────────────────────────────

export const row52YardExclusion = sqliteTable("row52_yard_exclusion", {
  locationId: integer("location_id").primaryKey(),
  reason: text("reason").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .notNull(),
});

export const yard = sqliteTable(
  "yard",
  {
    source: text("source").notNull(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    operator: text("operator"),
    address: text("address"),
    city: text("city").notNull(),
    state: text("state").notNull(),
    postalCode: text("postal_code"),
    lat: real("lat"),
    lng: real("lng"),
    websiteUrl: text("website_url"),
    phone: text("phone"),
    email: text("email"),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.source, table.code] })],
);

/**
 * Live vehicles per yard, derived from `vehicle`. Ingestion rebuilds a
 * source's rows in the same batch that publishes that source, so the
 * homepage reads one row per yard instead of scanning inventory.
 */
export const yardInventory = sqliteTable(
  "yard_inventory",
  {
    source: text("source").notNull(),
    locationCode: text("location_code").notNull(),
    locationName: text("location_name").notNull(),
    locationCity: text("location_city").notNull(),
    stateAbbr: text("state_abbr").notNull(),
    lat: real("lat").notNull(),
    lng: real("lng").notNull(),
    vehicleCount: integer("vehicle_count").notNull(),
    inventoryUrl: text("inventory_url"),
    // Unknown for inventory published before yard-level tracking began.
    lastPublishedAt: integer("last_published_at", { mode: "timestamp_ms" }),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.source, table.locationCode] })],
);

/**
 * Each yard's page summary (count, makes, arrivals; see YardSummary), stored
 * by the inventory refresh for the publication `built_for` names (the
 * yard_inventory row's updated_at). A cached summary that falls out of the
 * data cache is read back from here, 2 rows, instead of from the yard's
 * vehicles; a row whose `built_for` no longer matches is ignored.
 */
export const yardSummary = sqliteTable(
  "yard_summary",
  {
    source: text("source").notNull(),
    locationCode: text("location_code").notNull(),
    builtFor: integer("built_for", { mode: "timestamp_ms" }).notNull(),
    data: text("data").notNull(),
    // YardInventory.contentHash of the vehicles it was built from: a rebuild
    // with the same hash changed nothing its pages show.
    contentHash: text("content_hash").notNull(),
    // When the content hash last changed: the inventory refresh expires the
    // cached pages of yards that changed since its previous run.
    contentChangedAt: integer("content_changed_at", {
      mode: "timestamp_ms",
    }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.source, table.locationCode] })],
);

/**
 * Live vehicles per source and state that may count as new this week, grouped
 * by their raw arrival fields. Ingestion rebuilds a source's rows with its
 * `yard_inventory` rows, keeping only arrivals from the 8 days before the
 * rebuild, so state pages count new arrivals from a few thousand rows instead
 * of every vehicle in the state. Readers apply the exact week.
 */
export const stateRecentArrival = sqliteTable(
  "state_recent_arrival",
  {
    source: text("source").notNull(),
    stateAbbr: text("state_abbr").notNull(),
    availableDate: text("available_date"),
    observedArrivalAt: integer("observed_arrival_at", {
      mode: "timestamp_ms",
    }),
    vehicleCount: integer("vehicle_count").notNull(),
  },
  // Each publication replaces its sources' rows; without this the delete
  // read the whole table every time.
  (table) => [index("state_recent_arrival_source_idx").on(table.source)],
);

/**
 * Retains published yard history even after its last vehicle is retired.
 * `establishedAt` is the run timestamp of the yard's first published crawl;
 * yards that already had inventory when this table was added use epoch 0.
 */
export const yardArrivalBaseline = sqliteTable(
  "yard_arrival_baseline",
  {
    source: text("source").notNull(),
    locationCode: text("location_code").notNull(),
    establishedAt: integer("established_at", {
      mode: "timestamp_ms",
    }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.source, table.locationCode] })],
);

/**
 * What each accepted run learned about each yard, so "Last checked" names a
 * check we can prove. `outcome` is the latest accepted run's result for the
 * yard (`YardCheckOutcome`); `lastCheckedAt` advances only when that result
 * is "fetched", a live request this run. A null `lastCheckedRunId` beside a
 * date marks one inherited from `yard_inventory.last_published_at` when the
 * table was added. `lastChangedAt` is the last run that changed the yard's
 * inventory and `lastArrivalAt` its newest first sighting.
 */
export const yardCheck = sqliteTable(
  "yard_check",
  {
    source: text("source").notNull(),
    locationCode: text("location_code").notNull(),
    outcome: text("outcome", { enum: YARD_CHECK_OUTCOMES }).notNull(),
    reportedAt: integer("reported_at", { mode: "timestamp_ms" }).notNull(),
    reportedRunId: text("reported_run_id"),
    lastCheckedAt: integer("last_checked_at", { mode: "timestamp_ms" }),
    lastCheckedRunId: text("last_checked_run_id"),
    lastChangedAt: integer("last_changed_at", { mode: "timestamp_ms" }),
    lastArrivalAt: integer("last_arrival_at", { mode: "timestamp_ms" }),
    consecutiveUncheckedRuns: integer("consecutive_unchecked_runs")
      .default(0)
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.source, table.locationCode] }),
    check(
      "yard_check_outcome_check",
      sql`${table.outcome} in ('fetched', 'preserved', 'blocked', 'replayed', 'unreported')`,
    ),
    check(
      "yard_check_checked_run_check",
      sql`${table.lastCheckedRunId} is null or ${table.lastCheckedAt} is not null`,
    ),
  ],
);

/** Pattern identities only; failed attempts have no canonical fields and expire. */
export const vinDecodeCache = sqliteTable("vin_decode_cache", {
  pattern: text("pattern").primaryKey(),
  data: text("data", { mode: "json" }).$type<{
    make: string;
    model: string;
    year: number;
    trim: string | null;
    series?: string | null;
    series2?: string | null;
    driveType?: string | null;
    electrificationLevel?: string | null;
  }>(),
  retryAfter: integer("retry_after", { mode: "timestamp_ms" }),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

/**
 * The search schema version each Algolia index has finished migrating to,
 * recorded in Turso so ingestion can choose its vehicle identities without
 * an Algolia request (the index may be blocked or frozen).
 */
export const searchIndexSchema = sqliteTable("search_index_schema", {
  indexName: text("index_name").primaryKey(),
  version: integer("version").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const vehicleModelRedirect = sqliteTable("vehicle_model_redirect", {
  fromPath: text("from_path").primaryKey(),
  toPath: text("to_path").notNull(),
});

export const vehicle = sqliteTable(
  "vehicle",
  {
    vin: text("vin").primaryKey(),
    source: text("source").notNull(), // Canonical ingestion source key
    year: integer("year").notNull(),
    make: text("make").notNull(),
    model: text("model").notNull(),
    sourceMake: text("source_make"),
    sourceModel: text("source_model"),
    color: text("color"),
    stockNumber: text("stock_number"),
    imageUrl: text("image_url"),
    availableDate: text("available_date"),
    observedArrivalAt: integer("observed_arrival_at", { mode: "timestamp_ms" }),
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
    // Decided when the VIN is first planned; see FirstSighting.
    firstSighting: text("first_sighting", { enum: FirstSighting.values })
      .default("arrival")
      .notNull(),
    lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" }).notNull(),
    missingSinceAt: integer("missing_since_at", { mode: "timestamp_ms" }),
    missingRunCount: integer("missing_run_count"),
  },
  (table) => [
    index("vehicle_source_idx").on(table.source),
    index("vehicle_source_vin_idx").on(table.source, table.vin),
    index("vehicle_make_model_idx").on(table.make, table.model),
    index("vehicle_first_seen_at_idx").on(table.firstSeenAt),
    // The homepage's newest live vehicles: filter, sort, and tie-break from
    // the index, so it reads only the rows it shows.
    index("vehicle_recent_idx").on(
      table.missingSinceAt,
      sql`${table.firstSeenAt} desc`,
      table.vin,
    ),
    index("vehicle_last_seen_at_idx").on(table.lastSeenAt),
    index("vehicle_missing_since_at_idx").on(table.missingSinceAt),
    index("vehicle_missing_run_count_idx").on(table.missingRunCount),
    index("vehicle_location_code_idx").on(table.locationCode),
    // Covers per-yard live counts for yard_inventory without reading rows.
    index("vehicle_yard_live_idx").on(
      table.source,
      table.locationCode,
      table.missingSinceAt,
    ),
    // One make's live vehicles at a yard, for its make and model pages:
    // only the rows those pages show, not the whole yard.
    index("vehicle_yard_make_live_idx")
      .on(table.source, table.locationCode, table.make)
      .where(sql`missing_since_at is null`),
    index("vehicle_state_abbr_idx").on(table.stateAbbr),
  ],
);

export const ingestionRun = sqliteTable(
  "ingestion_run",
  {
    id: text("id").primaryKey(),
    source: text("source").notNull(), // Canonical ingestion source key or "all"
    scheduleKey: text("schedule_key"),
    workflowRunId: text("workflow_run_id"),
    status: text("status").notNull(), // "running" | "success" | "error" | "abandoned"
    stage: text("stage").default("sources").notNull(),
    activeSlot: integer("active_slot"), // 1 for a source's one nonterminal run, null otherwise
    // When this run claimed the shared commit. One active run holds it at a
    // time; it also stamps the vehicles the run first publishes.
    commitStartedAt: integer("commit_started_at", { mode: "timestamp_ms" }),
    // When validation staged this run for the commit. Waiters claim the
    // commit in this order (FIFO), and a staged snapshot expires after 24 h.
    readyAt: integer("ready_at", { mode: "timestamp_ms" }),
    // Workflow executions that failed; repeated failures abandon the run.
    executionFailures: integer("execution_failures").default(0).notNull(),
    reconciliationCursor: text("reconciliation_cursor"),
    projectorCursor: integer("projector_cursor").default(0).notNull(),
    fullReindexRequired: integer("full_reindex_required", { mode: "boolean" })
      .default(false)
      .notNull(),
    fullReindexCursor: text("full_reindex_cursor"),
    fullReindexMoveTaskId: integer("full_reindex_move_task_id"),
    alertMatchCursor: text("alert_match_cursor"),
    acceptedSources: text("accepted_sources"), // JSON array of canonical source keys
    inventoryOutcome: text("inventory_outcome"), // "published" | "published_degraded"
    publicationSequence: integer("publication_sequence"),
    publishedVehicleCount: integer("published_vehicle_count"),
    publishedYardCount: integer("published_yard_count"),
    vehiclesUpserted: integer("vehicles_upserted").default(0),
    vehiclesDeleted: integer("vehicles_deleted").default(0),
    errors: text("errors"), // JSON array of error strings
    executionErrors: text("execution_errors"), // JSON array of recoverable executor failures
    startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
    lastProgressAt: integer("last_progress_at", {
      mode: "timestamp_ms",
    }).notNull(),
    inventoryPublishedAt: integer("inventory_published_at", {
      mode: "timestamp_ms",
    }),
    searchPublishedAt: integer("search_published_at", {
      mode: "timestamp_ms",
    }),
    alertMatchingCompletedAt: integer("alert_matching_completed_at", {
      mode: "timestamp_ms",
    }),
    releasedAt: integer("released_at", { mode: "timestamp_ms" }),
    completedAt: integer("completed_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    uniqueIndex("ingestion_run_active_source_idx").on(
      table.source,
      table.activeSlot,
    ),
    index("ingestion_run_active_commit_idx").on(
      table.activeSlot,
      table.commitStartedAt,
      table.source,
    ),
    index("ingestion_run_commit_queue_idx").on(
      table.activeSlot,
      table.commitStartedAt,
      table.readyAt,
    ),
    index("ingestion_run_retention_idx")
      .on(table.completedAt)
      .where(sql`active_slot is null`),
    index("ingestion_run_schedule_key_idx").on(table.scheduleKey),
    index("ingestion_run_search_published_at_idx").on(table.searchPublishedAt),
    index("ingestion_run_stage_idx").on(table.stage),
    // The admin run lists join each source run to these. They are stored
    // after errors, so the table read walked each run's error text.
    index("ingestion_run_admin_idx").on(
      table.id,
      table.status,
      table.stage,
      table.inventoryPublishedAt,
    ),
    // The admin search page asks whether any run owes a full rebuild; a
    // table scan walked every run's error text to reach the flag.
    index("ingestion_run_full_reindex_required_idx").on(
      table.fullReindexRequired,
    ),
    // Each publication and every inventory refresh check reads
    // max(publication_sequence); without this each read walked every run.
    index("ingestion_run_publication_sequence_idx").on(
      table.publicationSequence,
    ),
  ],
);

export const ingestionSourceRun = sqliteTable(
  "ingestion_source_run",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => ingestionRun.id, { onDelete: "cascade" }),
    source: text("source").notNull(), // Canonical ingestion source key
    status: text("status").notNull(), // "running" | "success" | "error" | "partial"
    startCursor: text("start_cursor"),
    nextCursor: text("next_cursor"),
    pagesProcessed: integer("pages_processed").default(0).notNull(),
    vehiclesProcessed: integer("vehicles_processed").default(0).notNull(),
    uniqueVehicles: integer("unique_vehicles").default(0).notNull(),
    duplicateVehicles: integer("duplicate_vehicles").default(0).notNull(),
    rejectedVehicles: integer("rejected_vehicles").default(0).notNull(),
    acceptanceStatus: text("acceptance_status").default("pending").notNull(),
    validationErrors: text("validation_errors"),
    errors: text("errors"), // JSON array of error strings
    // JSON array of Blob pathnames, one per checkpointed snapshot chunk.
    snapshotChunks: text("snapshot_chunks").default("[]").notNull(),
    startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
    completedAt: integer("completed_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    index("ingestion_source_run_run_id_idx").on(table.runId),
    index("ingestion_source_run_source_idx").on(table.source),
    index("ingestion_source_run_status_idx").on(table.status),
    // Every column after the cursors, which reach megabytes, costs a walk
    // through them: reading acceptance_status from the table pulled ~130 MB
    // per query. These two indexes cover the recent-run reads instead.
    // Status, page freshness and the admin sources list read every source's
    // recent runs through this one.
    index("ingestion_source_run_started_at_idx").on(
      table.startedAt,
      table.source,
      table.acceptanceStatus,
      table.runId,
      table.id,
      table.status,
      table.completedAt,
      table.pagesProcessed,
      table.vehiclesProcessed,
      table.uniqueVehicles,
      table.duplicateVehicles,
      table.rejectedVehicles,
    ),
    // One source's runs, newest first, with their error text (about 2.6 MB
    // across every row), for its admin page and the latest runs' errors.
    index("ingestion_source_run_source_started_at_idx").on(
      table.source,
      table.startedAt,
      table.acceptanceStatus,
      table.runId,
      table.id,
      table.status,
      table.completedAt,
      table.pagesProcessed,
      table.vehiclesProcessed,
      table.uniqueVehicles,
      table.duplicateVehicles,
      table.rejectedVehicles,
      table.errors,
      table.validationErrors,
    ),
  ],
);

// When vehicles left their yard. Ingestion hard-deletes a missing vehicle
// after a few runs, so a separate capture copies each one here first; this is
// the only lasting record of how long vehicles stay. One row per departure:
// departed_at is the first run the vehicle was missing.
export const vehicleDeparture = sqliteTable(
  "vehicle_departure",
  {
    vin: text("vin").notNull(),
    source: text("source").notNull(),
    locationCode: text("location_code").notNull(),
    year: integer("year").notNull(),
    make: text("make").notNull(),
    model: text("model").notNull(),
    availableDate: text("available_date"),
    firstSeenAt: integer("first_seen_at", { mode: "timestamp_ms" }).notNull(),
    // The departed listing's, which a relist keeps.
    firstSighting: text("first_sighting", { enum: FirstSighting.values })
      .default("arrival")
      .notNull(),
    departedAt: integer("departed_at", { mode: "timestamp_ms" }).notNull(),
    recordedAt: integer("recorded_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.vin, table.departedAt] }),
    index("vehicle_departure_yard_idx").on(
      table.source,
      table.locationCode,
      table.departedAt,
    ),
    index("vehicle_departure_departed_at_idx").on(table.departedAt),
  ],
);

// Make and model aggregates that pages list: live vehicles per make, and each
// make's models per yard. Computing them reads every vehicle, so they are
// computed once per publication and stored here, and pages, sitemaps and
// builds read a row by key. `data` is JSON, validated on read.
export const inventorySnapshot = sqliteTable("inventory_snapshot", {
  key: text("key").primaryKey(),
  data: text("data").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

// Presence evidence for inventory records that cannot yet become full snapshots.
export const vehicleObservation = sqliteTable(
  "vehicle_observation",
  {
    runId: text("run_id")
      .notNull()
      .references(() => ingestionRun.id, { onDelete: "cascade" }),
    source: text("source").notNull(),
    vin: text("vin").notNull(),
  },
  (table) => [primaryKey({ columns: [table.runId, table.source, table.vin] })],
);

export const vehicleSnapshot = sqliteTable(
  "vehicle_snapshot",
  {
    runId: text("run_id")
      .notNull()
      .references(() => ingestionRun.id, { onDelete: "cascade" }),
    source: text("source").notNull(), // Canonical ingestion source key
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

// Archival delivery history. Keep this declaration so schema tooling preserves
// the production table, but route all runtime ingestion through vehicleChange.
export const legacyVehicleChange = sqliteTable(
  "vehicle_change",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    runId: text("run_id")
      .notNull()
      .references(() => ingestionRun.id, { onDelete: "cascade" }),
    vin: text("vin").notNull(),
    changeType: text("change_type").notNull(),
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

export const vehicleChange = sqliteTable(
  "vehicle_change_v2",
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
    index("vehicle_change_v2_run_id_idx").on(table.runId),
    uniqueIndex("vehicle_change_v2_run_vin_type_idx")
      .on(table.runId, table.vin, table.changeType)
      .where(sql`processed_at is null`),
    index("vehicle_change_v2_vin_idx").on(table.vin),
    index("vehicle_change_v2_processed_at_idx").on(table.processedAt, table.id),
  ],
);

// One saved-search alert check per ingestion day, independent of source
// runs. It matches vehicles first seen through `checkedThrough`, a bound that
// stops short of any commit whose vehicles are not yet in the search index.
export const searchAlertCheck = sqliteTable(
  "search_alert_check",
  {
    id: text("id").primaryKey(),
    day: text("day").notNull(), // IngestionDay key
    status: text("status", {
      enum: ["running", "complete", "superseded"],
    }).notNull(),
    checkedThrough: integer("checked_through", {
      mode: "timestamp_ms",
    }).notNull(),
    // Last saved search id checked, in id order.
    searchCursor: text("search_cursor"),
    startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
    lastProgressAt: integer("last_progress_at", {
      mode: "timestamp_ms",
    }).notNull(),
    completedAt: integer("completed_at", { mode: "timestamp_ms" }),
  },
  (table) => [uniqueIndex("search_alert_check_day_idx").on(table.day)],
);

export const searchNotificationIntent = sqliteTable(
  "search_notification_intent",
  {
    id: text("id").primaryKey(),
    // Intents from before daily alert checks belong to the ingestion run
    // that matched them; newer ones belong to their alert check.
    runId: text("run_id").references(() => ingestionRun.id, {
      onDelete: "cascade",
    }),
    alertCheckId: text("alert_check_id").references(() => searchAlertCheck.id, {
      onDelete: "cascade",
    }),
    publicationSequence: integer("publication_sequence").notNull(),
    savedSearchId: text("saved_search_id")
      .notNull()
      .references(() => savedSearch.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    channel: text("channel").notNull(), // "email" | "discord"
    searchMatchVersion: integer("search_match_version").notNull(),
    channelConfigVersion: integer("channel_config_version").notNull(),
    payload: text("payload").notNull(),
    status: text("status").default("pending").notNull(),
    attempts: integer("attempts").default(0).notNull(),
    deliveryGroupId: text("delivery_group_id"),
    claimToken: text("claim_token"),
    claimedAt: integer("claimed_at", { mode: "timestamp_ms" }),
    nextAttemptAt: integer("next_attempt_at", { mode: "timestamp_ms" }),
    lastError: text("last_error"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    deliveredAt: integer("delivered_at", { mode: "timestamp_ms" }),
    cancelledAt: integer("cancelled_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    uniqueIndex("search_notification_intent_dedupe_idx").on(
      table.savedSearchId,
      table.publicationSequence,
      table.channel,
    ),
    index("search_notification_intent_delivery_idx").on(
      table.status,
      table.claimedAt,
      table.id,
    ),
    index("search_notification_intent_run_idx").on(table.runId),
    index("search_notification_intent_alert_check_idx").on(table.alertCheckId),
    index("search_notification_intent_recipient_idx").on(
      table.userId,
      table.channel,
      table.status,
    ),
    check(
      "search_notification_intent_owner_check",
      sql`(run_id is null) <> (alert_check_id is null)`,
    ),
  ],
);

// Delivery history survives saved-search deletion and ingestion-state cleanup.
export const searchNotificationDelivery = sqliteTable(
  "search_notification_delivery",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    channel: text("channel").notNull(),
    deliveredAt: integer("delivered_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.channel] })],
);

/**
 * One row per downstream consumer (and per part of one). `kind` says what
 * `last_processed_change_id` counts: a publication_sequence, a
 * vehicle_change_v2 id, or nothing for a daily job keyed on `job_day`. The
 * remaining columns hold a consumer's resumable cursor, circuit breaker and
 * health; see ConsumerCheckpoint.
 */
export const ingestionProjectorCheckpoint = sqliteTable(
  "ingestion_projector_checkpoint",
  {
    name: text("name").primaryKey(),
    kind: text("kind").default("publication").notNull(),
    lastProcessedChangeId: integer("last_processed_change_id")
      .default(0)
      .notNull(),
    jobCursor: text("job_cursor"),
    jobDay: text("job_day"),
    blockedUntil: integer("blocked_until", { mode: "timestamp_ms" }),
    failureCount: integer("failure_count").default(0).notNull(),
    lastErrorTag: text("last_error_tag"),
    lastSuccessAt: integer("last_success_at", { mode: "timestamp_ms" }),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => new Date())
      .notNull(),
  },
);

/**
 * Generations of the search index, built by the search projector from the
 * `vehicle` table into a temporary index and moved over the live one. Each
 * environment (deployment) has at most one in-flight generation and one live
 * generation. See SearchIndexGeneration for the lifecycle.
 */
export const searchIndexGeneration = sqliteTable(
  "search_index_generation",
  {
    id: text("id").primaryKey(),
    environment: text("environment").notNull(),
    indexName: text("index_name").notNull(),
    // "requested" | "loading" | "moving" | "live" | "superseded" | "discarded"
    status: text("status").notNull(),
    reason: text("reason").notNull(), // "bootstrap" | "operator" | "drift"
    tempIndexName: text("temp_index_name"),
    // The outbox horizon when loading began; replay starts after it.
    snapshotChangeId: integer("snapshot_change_id"),
    vinCursor: text("vin_cursor"),
    recordsLoaded: integer("records_loaded").default(0).notNull(),
    moveTaskId: integer("move_task_id"),
    requestedAt: integer("requested_at", { mode: "timestamp_ms" }).notNull(),
    startedAt: integer("started_at", { mode: "timestamp_ms" }),
    liveAt: integer("live_at", { mode: "timestamp_ms" }),
    endedAt: integer("ended_at", { mode: "timestamp_ms" }),
    tempIndexDeletedAt: integer("temp_index_deleted_at", {
      mode: "timestamp_ms",
    }),
    lastError: text("last_error"),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("search_index_generation_active_idx")
      .on(table.environment)
      .where(sql`status in ('requested', 'loading', 'moving')`),
    uniqueIndex("search_index_generation_live_idx")
      .on(table.environment)
      .where(sql`status = 'live'`),
  ],
);

/** Outbox changes the search backend or the projection rejected. */
export const searchDeadLetter = sqliteTable(
  "search_dead_letter",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    changeId: integer("change_id").notNull(),
    vin: text("vin").notNull(),
    environment: text("environment").notNull(),
    indexName: text("index_name").notNull(),
    errorTag: text("error_tag").notNull(),
    detail: text("detail").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("search_dead_letter_vin_idx").on(table.vin)],
);

/** Cached yard geolocation verified against the yard's own AutoRecycler records. */
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
    resolutionVersion: integer("resolution_version").default(0).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("autorecycler_org_geo_updated_at_idx").on(table.updatedAt)],
);

/**
 * The owner's per-source controls from /admin. A source without a row runs
 * and is shown. `ingestion` paused leaves the source out of new ingestion
 * runs, together with its Vercel flag (paused if either says so).
 * `visibility` hidden keeps it off the public site, with the reason the
 * owner gave; see SourceControl and docs/runbooks/hide-source.md.
 */
export const sourceControl = sqliteTable(
  "source_control",
  {
    source: text("source").primaryKey(),
    ingestion: text("ingestion", { enum: ["running", "paused"] })
      .default("running")
      .notNull(),
    visibility: text("visibility", { enum: ["shown", "hidden"] })
      .default("shown")
      .notNull(),
    hiddenReason: text("hidden_reason"),
    // Null when a migration set the row, not a person.
    updatedByUserId: text("updated_by_user_id"),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  () => [
    check(
      "source_control_ingestion_check",
      sql`ingestion in ('running', 'paused')`,
    ),
    check(
      "source_control_visibility_check",
      sql`visibility in ('shown', 'hidden')`,
    ),
    check(
      "source_control_hidden_reason_check",
      sql`(visibility = 'hidden') = (hidden_reason is not null and trim(hidden_reason) != '')`,
    ),
  ],
);

/**
 * What admins did from /admin, newest last. Append-only: triggers in the
 * migration refuse updates and deletes. Not tied to `user`, so deleting an
 * account keeps its history.
 */
export const adminActionLog = sqliteTable(
  "admin_action_log",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id").notNull(),
    // AdminAction["action"]
    action: text("action").notNull(),
    // The source acted on, when the action was on one.
    source: text("source"),
    detail: text("detail"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("admin_action_log_source_idx").on(table.source, table.createdAt),
  ],
);

/**
 * Each Kernel browser a metered source opened, for its monthly spend guard
 * (`KernelUsage` in src/server/ingestion/kernel-usage.ts). `ended_at` is set
 * when the browser is deleted; a row without it counts as open for the
 * browser's longest possible life, so a process that died mid-chunk still
 * counts what Kernel billed.
 */
export const kernelBrowserUsage = sqliteTable(
  "kernel_browser_usage",
  {
    id: text("id").primaryKey(),
    source: text("source").notNull(),
    mode: text("mode", { enum: ["headless", "headful"] }).notNull(),
    startedAt: integer("started_at").notNull(),
    endedAt: integer("ended_at"),
  },
  (table) => [
    index("kernel_browser_usage_source_idx").on(table.source, table.startedAt),
    check(
      "kernel_browser_usage_mode_check",
      sql`mode in ('headless', 'headful')`,
    ),
    check(
      "kernel_browser_usage_ended_check",
      sql`ended_at is null or ended_at >= started_at`,
    ),
  ],
);
