import { afterEach, describe, expect, test } from "bun:test";
import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { savedSearch } from "~/schema";
import { createSearchAlertClaimRepository } from "./search-alert-claim-repository";

const TEST_SCHEMA = `
  drop table if exists saved_search;
  create table saved_search (
    id text primary key,
    user_id text not null,
    name text not null,
    query text not null,
    filters text not null,
    email_alerts_enabled integer not null,
    discord_alerts_enabled integer not null,
    last_checked_at integer,
    processing_lock integer,
    created_at integer not null,
    updated_at integer not null
  );
`;

const clients: Client[] = [];

afterEach(() => {
  for (const client of clients.splice(0)) {
    client.close();
  }
});

async function createTestRepository() {
  const client = createClient({ url: "file::memory:?cache=shared" });
  clients.push(client);
  await client.executeMultiple(TEST_SCHEMA);
  const database = drizzle(client);
  return {
    database,
    repository: createSearchAlertClaimRepository(database),
  };
}

function searchValues(id: string, processingLock: Date | null = null) {
  const now = new Date("2026-08-21T07:00:00.000Z");
  return {
    id,
    userId: "user-1",
    name: id,
    query: "volvo",
    filters: "{}",
    emailAlertsEnabled: true,
    discordAlertsEnabled: false,
    lastCheckedAt: now,
    processingLock,
    createdAt: now,
    updatedAt: now,
  };
}

describe("search alert claim repository", () => {
  test("claims the authoritative search set when it changes after selection", async () => {
    const { database, repository } = await createTestRepository();
    await database.insert(savedSearch).values(searchValues("search-1"));
    const initialSelection = await database
      .select({ id: savedSearch.id })
      .from(savedSearch);

    await database.insert(savedSearch).values(searchValues("search-2"));
    const claim = await repository.claimUserSearches(
      "user-1",
      new Date("2026-08-21T06:55:00.000Z"),
    );

    expect(initialSelection.map(({ id }) => id)).toEqual(["search-1"]);
    expect(claim?.searches.map(({ id }) => id).sort()).toEqual([
      "search-1",
      "search-2",
    ]);
  });

  test("releases a partial claim when another search is already locked", async () => {
    const { database, repository } = await createTestRepository();
    const activeLock = new Date("2026-08-21T06:59:00.000Z");
    await database
      .insert(savedSearch)
      .values([searchValues("search-1", activeLock), searchValues("search-2")]);

    const claim = await repository.claimUserSearches(
      "user-1",
      new Date("2026-08-21T06:55:00.000Z"),
    );
    const locks = await database
      .select({ id: savedSearch.id, lock: savedSearch.processingLock })
      .from(savedSearch);

    expect(claim).toBeNull();
    expect(locks.sort(({ id: a }, { id: b }) => a.localeCompare(b))).toEqual([
      { id: "search-1", lock: activeLock },
      { id: "search-2", lock: null },
    ]);
  });
});
