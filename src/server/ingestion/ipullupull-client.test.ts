import { afterEach, expect, test } from "bun:test";
import { Effect } from "effect";
import {
  fetchIPullUPullCatalog,
  IPULLUPULL_EXPORT_URL,
  IPULLUPULL_MAX_CATALOG_BYTES,
  parseIPullUPullCsv,
} from "./ipullupull-client";

const fixture = await Bun.file(
  new URL("./fixtures/ipullupull-sample.csv", import.meta.url),
).text();
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("parses BOM, CRLF, quoted commas, embedded newlines, escaped quotes and duplicate unused columns", async () => {
  const csv =
    "\ufeff" +
    fixture
      .replaceAll("\n", "\r\n")
      .replace("ESCAPE HYBRID", '"ESCAPE, ""HYBRID""\r\nSUV"');
  const rows = await Effect.runPromise(parseIPullUPullCsv(csv));
  expect(rows).toHaveLength(4);
  expect(rows[0]?.Model).toBe('ESCAPE, "HYBRID"\r\nSUV');
  const extra =
    fixture
      .trimEnd()
      .split("\n")
      .map(
        (line, i) =>
          line + (i === 0 ? ",Engine For Sale,Engine For Sale" : ",yes,no"),
      )
      .join("\n") + "\n";
  expect(await Effect.runPromise(parseIPullUPullCsv(extra))).toHaveLength(4);
});

test.each([
  ["HTML", "<html>error</html>\n"],
  ["empty", ""],
  ["header only", fixture.split("\n")[0] + "\n"],
  ["missing required header", fixture.replace("Vin,", "VIN,")],
  ["duplicate required header", fixture.replace("Engine\n", "Vin\n")],
  ["unterminated last row", fixture.trimEnd()],
  ["unclosed quote", fixture.replace("ESCAPE HYBRID", '"ESCAPE HYBRID')],
  ["short row", fixture.replace("FRE117278,Available,", "FRE117278,")],
  ["error appended", fixture + "Export failed\n"],
])("rejects malformed CSV: %s", async (_label, text) => {
  expect(
    (await Effect.runPromise(Effect.either(parseIPullUPullCsv(text))))._tag,
  ).toBe("Left");
});

test("fetches only the complete unfiltered public export", async () => {
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe(IPULLUPULL_EXPORT_URL);
      expect(init?.method).toBe("GET");
      expect(new Headers(init?.headers).get("accept")).toBe("text/csv");
      return new Response(fixture, {
        headers: {
          "Content-Type": "text/csv; charset=UTF-8",
          "Content-Length": String(Buffer.byteLength(fixture)),
        },
      });
    },
    { preconnect: originalFetch.preconnect },
  );
  expect(await Effect.runPromise(fetchIPullUPullCatalog())).toHaveLength(4);
});

const responseCases: {
  label: string;
  status: number;
  headers: Record<string, string>;
}[] = [
  { label: "partial HTTP", status: 206, headers: {} },
  {
    label: "partial range",
    status: 200,
    headers: { "Content-Range": "bytes 0-100/1000" },
  },
  { label: "next link", status: 200, headers: { Link: '</next>; rel="next"' } },
  {
    label: "wrong MIME",
    status: 200,
    headers: { "Content-Type": "text/html" },
  },
  {
    label: "truncated length",
    status: 200,
    headers: { "Content-Length": "123456" },
  },
  { label: "HTTP failure", status: 403, headers: {} },
];
test.each(responseCases)(
  "fails closed on $label",
  async ({ status, headers }) => {
    let requests = 0;
    globalThis.fetch = Object.assign(
      async () => {
        requests++;
        return new Response(fixture, {
          status,
          headers: { "Content-Type": "text/csv", ...headers },
        });
      },
      { preconnect: originalFetch.preconnect },
    );
    expect(
      (await Effect.runPromise(Effect.either(fetchIPullUPullCatalog())))._tag,
    ).toBe("Left");
    expect(requests).toBe(1);
  },
);

test("bounds downloaded bytes before parsing", async () => {
  globalThis.fetch = Object.assign(
    async () =>
      new Response("x".repeat(IPULLUPULL_MAX_CATALOG_BYTES + 1), {
        headers: { "Content-Type": "text/csv" },
      }),
    { preconnect: originalFetch.preconnect },
  );
  const result = await Effect.runPromise(
    Effect.either(fetchIPullUPullCatalog()),
  );
  expect(result._tag).toBe("Left");
  if (result._tag === "Left") expect(result.left.message).toContain("4 MiB");
});
