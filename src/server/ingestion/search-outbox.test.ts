import { describe, expect, test } from "bun:test";
import { SearchOutbox } from "./search-outbox";
import {
  createProjectorDatabase,
  insertRunWithChanges,
} from "./search-projector-test-fixtures";

describe("search outbox", () => {
  test("the horizon stops below the first change of a run still reconciling", async () => {
    const { client, database } = await createProjectorDatabase();
    try {
      expect(await SearchOutbox.horizon(database)).toBe(0);
      const published = await insertRunWithChanges(
        client,
        {
          id: "published",
          status: "success",
          stage: "released",
          activeSlot: null,
        },
        [
          ["VIN1", "upsert"],
          ["VIN2", "delete"],
        ],
      );
      expect(await SearchOutbox.horizon(database)).toBe(published[1] ?? -1);
      // Claimed the commit but wrote nothing yet: nothing to hold back.
      await insertRunWithChanges(
        client,
        {
          id: "reconciling",
          status: "running",
          stage: "reconcile_upsert",
          activeSlot: 1,
        },
        [],
      );
      expect(await SearchOutbox.horizon(database)).toBe(published[1] ?? -1);
      await client.execute(
        "insert into vehicle_change_v2 (run_id, vin, change_type, payload_version, created_at) values ('reconciling', 'VIN3', 'upsert', 1, 0)",
      );
      expect(await SearchOutbox.horizon(database)).toBe(published[1] ?? -1);
      expect(
        await SearchOutbox.read(database, {
          after: 0,
          through: await SearchOutbox.horizon(database),
          limit: 10,
        }),
      ).toEqual([
        { id: published[0] ?? -1, vin: "VIN1", changeType: "upsert" },
        { id: published[1] ?? -1, vin: "VIN2", changeType: "delete" },
      ]);
    } finally {
      client.close();
    }
  });

  test("ids only grow: rows written after a read sort after every id it saw, even after deletes", async () => {
    const { client, database } = await createProjectorDatabase();
    try {
      await insertRunWithChanges(
        client,
        { id: "first", status: "success", stage: "released", activeSlot: null },
        [["VIN1", "upsert"]],
      );
      const seen = await SearchOutbox.horizon(database);
      // A batch is one write transaction, like a reconciliation batch.
      await client.batch(
        [
          "insert into ingestion_run (id, source, status, stage, started_at, last_progress_at) values ('second', 'pyp', 'success', 'released', 0, 0)",
          "insert into vehicle_change_v2 (run_id, vin, change_type, payload_version, created_at) values ('second', 'VIN2', 'upsert', 1, 0), ('second', 'VIN3', 'upsert', 1, 0)",
        ],
        "write",
      );
      // Deleting the newest row must not let a later insert reuse its id.
      await client.execute("delete from vehicle_change_v2 where vin = 'VIN3'");
      await client.execute(
        "insert into vehicle_change_v2 (run_id, vin, change_type, payload_version, created_at) values ('second', 'VIN4', 'upsert', 1, 0)",
      );
      const rows = await SearchOutbox.read(database, {
        after: seen,
        through: Number.MAX_SAFE_INTEGER,
        limit: 10,
      });
      expect(rows.map((row) => row.vin)).toEqual(["VIN2", "VIN4"]);
      expect(rows.every((row) => row.id > seen)).toBe(true);
      expect(rows[1]?.id).toBe(seen + 3);
    } finally {
      client.close();
    }
  });
});
