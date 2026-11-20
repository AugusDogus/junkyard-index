import { expect, test } from "bun:test";
import {
  isDurableSourceCursorTerminal,
  serializeDurableSourceCursor,
} from "./durable-source";
import { Effect } from "effect";
import { streamRmmdtpInventory } from "./rmmdtp-connector";
import { RMMDTP_CONTRACT } from "./rmmdtp-configuration";
import { RmmdtpCursor } from "./rmmdtp-cursor";
import { rmmdtpFixture } from "./rmmdtp-test-fixtures";
import { RmmdtpResult } from "./rmmdtp-result";
import type { RmmdtpCanonicalVehicle } from "./rmmdtp-transform";

test("RMMDTP survives serialized chunks and emits only after the entire closing graph", async () => {
  let cursor = RmmdtpCursor.initial(RMMDTP_CONTRACT),
    reads = 0,
    yards = 0;
  const vehicles: RmmdtpCanonicalVehicle[] = [];
  const readPage = (url: string) =>
    Effect.sync(() => {
      const page = (reads % 5) + 1;
      expect(url).toBe(
        "https://rmmdtp.com/trucks/" +
          (page === 1 ? "" : `?page_number=${page}`),
      );
      expect(vehicles).toHaveLength(0);
      expect(yards).toBe(0);
      return rmmdtpFixture(reads++ < 5 ? "opening" : "closing", page);
    });
  for (let chunk = 0; chunk < 10; chunk++) {
    const result = await Effect.runPromise(
      streamRmmdtpInventory({
        contract: RMMDTP_CONTRACT,
        previousUniqueInventory: 103,
        startCursor: JSON.parse(JSON.stringify(cursor)),
        maxPages: 1,
        readPage,
        onYards: () =>
          Effect.sync(() => {
            yards++;
          }),
        onBatch: (batch) =>
          Effect.sync(() => {
            vehicles.push(...batch);
          }),
      }),
    );
    cursor = result.cursor;
    expect(result.status).toBe(chunk === 9 ? "complete" : "paused");
    expect(result.count).toBe(chunk === 9 ? 103 : 0);
    if (chunk === 9)
      expect(result.accounting).toEqual({
        recordsProcessed: 106,
        recordsExcluded: 2,
        recordsRejected: 1,
        duplicateVehicles: 0,
      });
  }
  expect(reads).toBe(10);
  expect(yards).toBe(1);
  expect(
    isDurableSourceCursorTerminal(
      "rmmdtp",
      serializeDurableSourceCursor(cursor),
    ),
  ).toBe(true);
  expect(vehicles).toHaveLength(103);
  const complete = await Effect.runPromise(
    streamRmmdtpInventory({
      contract: RMMDTP_CONTRACT,
      previousUniqueInventory: 103,
      startCursor: cursor,
      readPage,
      onBatch: () => Effect.die("Complete cursor emitted twice"),
    }),
  );
  expect(complete.count).toBe(0);
});

test("RMMDTP closing changes, truncation and failed requests emit no yards or donors", async () => {
  for (const failure of ["changed", "truncated", "request"] as const) {
    let reads = 0,
      emitted = 0;
    const result = await Effect.runPromise(
      Effect.either(
        streamRmmdtpInventory({
          contract: RMMDTP_CONTRACT,
          previousUniqueInventory: null,
          readPage: () => {
            const index = reads++;
            if (index === 5 && failure === "request")
              return Effect.fail(
                RmmdtpResult.error("fixture request", "Unavailable"),
              );
            let body = rmmdtpFixture(
              index < 5 ? "opening" : "closing",
              (index % 5) + 1,
            );
            if (index === 5)
              body =
                failure === "changed"
                  ? body.replace("266440", "266441")
                  : body.slice(0, -50);
            return Effect.succeed(body);
          },
          onYards: () =>
            Effect.sync(() => {
              emitted++;
            }),
          onBatch: () =>
            Effect.sync(() => {
              emitted++;
            }),
        }),
      ),
    );
    expect(result._tag).toBe("Left");
    expect(emitted).toBe(0);
    expect(reads).toBe(6);
  }
});

test("RMMDTP rejects corrupt and cross-contract cursors before dispatch", async () => {
  for (const input of [
    { ...RmmdtpCursor.initial(RMMDTP_CONTRACT), requests: 1 },
    { ...RmmdtpCursor.initial(RMMDTP_CONTRACT), source: "other" },
  ]) {
    let reads = 0;
    const result = await Effect.runPromise(
      Effect.either(
        streamRmmdtpInventory({
          contract: RMMDTP_CONTRACT,
          previousUniqueInventory: null,
          startCursor: input,
          readPage: () =>
            Effect.sync(() => {
              reads++;
              return "";
            }),
          onBatch: () => Effect.void,
        }),
      ),
    );
    expect(result._tag).toBe("Left");
    expect(reads).toBe(0);
  }
  expect(
    RmmdtpCursor.parse(RmmdtpCursor.initial(RMMDTP_CONTRACT), {
      ...RMMDTP_CONTRACT,
      minimumUniqueInventory: 81,
    }).ok,
  ).toBe(false);
});

test("RMMDTP complete-source quality failures emit nothing after closing verification", async () => {
  for (const kind of ["minimum", "drift"] as const) {
    let cursor: unknown = undefined,
      reads = 0,
      emitted = 0,
      failed = false;
    for (let chunk = 0; chunk < 2; chunk++) {
      const result = await Effect.runPromise(
        Effect.either(
          streamRmmdtpInventory({
            contract:
              kind === "minimum"
                ? { ...RMMDTP_CONTRACT, minimumUniqueInventory: 104 }
                : RMMDTP_CONTRACT,
            previousUniqueInventory: kind === "drift" ? 208 : null,
            startCursor: cursor,
            readPage: () =>
              Effect.succeed(
                rmmdtpFixture(
                  reads < 5 ? "opening" : "closing",
                  (reads++ % 5) + 1,
                ),
              ),
            onYards: () =>
              Effect.sync(() => {
                emitted++;
              }),
            onBatch: () =>
              Effect.sync(() => {
                emitted++;
              }),
          }),
        ),
      );
      if (result._tag === "Left") {
        failed = true;
        break;
      }
      cursor = JSON.parse(JSON.stringify(result.right.cursor));
    }
    expect(failed).toBe(true);
    expect(reads).toBe(10);
    expect(emitted).toBe(0);
  }
});

test("RMMDTP resumed evidence revalidates semantic hashes, graph prefixes, bytes and phases", async () => {
  const opening = await Effect.runPromise(
    streamRmmdtpInventory({
      contract: RMMDTP_CONTRACT,
      previousUniqueInventory: null,
      maxPages: 1,
      readPage: () => Effect.succeed(rmmdtpFixture("opening", 1)),
      onBatch: () => Effect.void,
    }),
  );
  const cursor = opening.cursor;
  if (cursor.phase !== "opening")
    throw new Error("Expected partial opening control");
  const first = cursor.pages[0];
  if (!first) throw new Error("Native page control is missing");
  expect(
    RmmdtpCursor.checkpoint({ ...cursor, requests: 2 }, RMMDTP_CONTRACT).ok,
  ).toBe(false);
  expect(
    RmmdtpCursor.checkpoint(
      { ...cursor, bytes: cursor.bytes - 1 },
      RMMDTP_CONTRACT,
    ).ok,
  ).toBe(false);
  expect(
    RmmdtpCursor.checkpoint(
      { ...cursor, pages: [{ ...first, records: first.records.slice(1) }] },
      RMMDTP_CONTRACT,
    ).ok,
  ).toBe(false);
  expect(
    RmmdtpCursor.checkpoint(
      {
        ...cursor,
        pages: [
          { ...first, nextUrl: "https://rmmdtp.com/trucks/?page_number=3" },
        ],
      },
      RMMDTP_CONTRACT,
    ).ok,
  ).toBe(false);
  expect(
    RmmdtpCursor.checkpoint(
      { ...cursor, phase: "complete", closed: [] },
      RMMDTP_CONTRACT,
    ).ok,
  ).toBe(false);
});
