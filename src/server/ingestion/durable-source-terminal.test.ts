import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { INGESTION_SOURCES } from "~/lib/ingestion-source";
import {
  DURABLE_SOURCE_DEFINITIONS,
  isDurableSourceCursorTerminal,
  parseDurableSourceCursor,
  serializeDurableSourceCursor,
} from "./durable-source";
import {
  MID_CRAWL_CURSOR_FIXTURES,
  TERMINAL_CURSOR_FIXTURES,
} from "./durable-source-terminal-test-fixtures";

describe("durable source terminal evidence", () => {
  test.each([...INGESTION_SOURCES])(
    "%s accepts its real finished cursor and rejects mid-crawl cursors",
    (source) => {
      const definition = DURABLE_SOURCE_DEFINITIONS[source];
      const fixture = TERMINAL_CURSOR_FIXTURES[source];
      const initial = serializeDurableSourceCursor(definition.initialCursor);
      if (fixture.kind === "connector-status") {
        expect(definition.terminal.kind).toBe("connector-status");
        expect(isDurableSourceCursorTerminal(source, initial)).toBe(true);
        return;
      }
      expect(definition.terminal.kind).toBe("cursor");
      for (const midCrawl of [
        initial,
        ...(MID_CRAWL_CURSOR_FIXTURES[source] ?? []),
      ])
        expect(isDurableSourceCursorTerminal(source, midCrawl)).toBe(false);
      if (fixture.kind === "wire") {
        expect(
          serializeDurableSourceCursor(
            parseDurableSourceCursor(source, fixture.terminal),
          ),
        ).toBe(fixture.terminal);
        expect(isDurableSourceCursorTerminal(source, fixture.terminal)).toBe(
          true,
        );
        return;
      }
      // The connector test serializes its real final cursor and asserts this.
      expect(fixture.file).toBe(`${source}-connector.test.ts`);
      expect(readFileSync(join(import.meta.dir, fixture.file), "utf8")).toMatch(
        new RegExp(`isDurableSourceCursorTerminal\\(\\s*"${source}",`),
      );
    },
  );

  test("only sources without a completion marker rely on connector status", () => {
    expect(
      INGESTION_SOURCES.filter(
        (source) =>
          DURABLE_SOURCE_DEFINITIONS[source].terminal.kind ===
          "connector-status",
      ),
    ).toEqual([
      "row52",
      "pullapart",
      "upullitne",
      "gopullit",
      "pullnsave",
      "tearapart",
      "wrenchapart",
    ]);
  });

  test.each([...INGESTION_SOURCES])(
    "%s fails closed without a parseable final cursor",
    (source) => {
      expect(isDurableSourceCursorTerminal(source, null)).toBe(false);
      expect(isDurableSourceCursorTerminal(source, "{not json")).toBe(false);
    },
  );
});
