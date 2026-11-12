import { expect, test } from "bun:test";
import { parseAlln1Owner, parseAlln1Page } from "./alln1-parser";
import {
  alln1TestOwner,
  alln1TestPage,
  alln1TestRecord,
} from "./alln1-test-fixtures";

test("All-N-1 parses native scope, complete table, agreeing pagination and optional metadata", () => {
  parseAlln1Owner(alln1TestOwner);
  const page = parseAlln1Page(alln1TestPage(), 1);
  expect(page.records).toEqual([alln1TestRecord]);
  expect(page).toMatchObject({ page: 1, lastPage: 1, nextUrl: null });
});
test("All-N-1 permits the native complete trailing cache comment", () => {
  expect(() =>
    parseAlln1Owner(alln1TestOwner + "<!-- Cache served by breeze CACHE -->"),
  ).not.toThrow();
});
test.each([
  ["truncated document", (body: string) => body.replace("</html>", "")],
  ["truncated cell", (body: string) => body.replace("</td>", "")],
  ["missing header", (body: string) => body.replace("Stock #", "ID")],
  ["wrong physical scope", (body: string) => body.replace("'MO42'", "'MO09'")],
  [
    "comment-only physical scope",
    (body: string) =>
      body.replace(
        "<script>var iisupullurgid = 'MO42';</script>",
        "<!-- var iisupullurgid = 'MO42'; -->",
      ),
  ],
  ...[
    "// var iisupullurgid = 'MO42';\n",
    "/* var iisupullurgid = 'MO42'; */",
    "const unrelated = \"var iisupullurgid = 'MO42';\";",
    "const unrelated = `var iisupullurgid = 'MO42';`;",
    "function unused() { var iisupullurgid = 'MO42'; }",
  ].map(
    (script) =>
      [
        "nonexecuting physical scope: " + script,
        (body: string) => body.replace("var iisupullurgid = 'MO42';", script),
      ] as const,
  ),
  [
    "nonexecutable scope script",
    (body: string) =>
      body.replace("<script>", '<script type="application/json">'),
  ],
  [
    "external script fallback scope",
    (body: string) => body.replace("<script>", '<script src="/other.js">'),
  ],
  [
    "nomodule scope script",
    (body: string) => body.replace("<script>", "<script nomodule>"),
  ],
  ...[
    "template",
    "textarea",
    "noscript",
    "title",
    "style",
    "xmp",
    "iframe",
    "noembed",
    "noframes",
    "plaintext",
  ].map(
    (tag) =>
      [
        "scope in inert " + tag,
        (body: string) =>
          body.replace(
            "<script>var iisupullurgid = 'MO42';</script>",
            "<" +
              tag +
              "><script>var iisupullurgid = 'MO42';</script></" +
              tag +
              ">",
          ),
      ] as const,
  ),
  [
    "scope after nested inert template",
    (body: string) =>
      body
        .replace("<script>", "<template><template></template><script>")
        .replace("</script>", "</script></template>"),
  ],
  [
    "filtered search",
    (body: string) =>
      body.replace('name="search" value=""', 'name="search" value="FORD"'),
  ],
  [
    "foreign pagination",
    (body: string) =>
      body.replaceAll(
        "/inventory/ANY/ANY/?k=1&amp;view=table&amp;pagenum=1",
        "https://example.com/inventory/ANY/ANY/?k=1&amp;view=table&amp;pagenum=1",
      ),
  ],
  [
    "duplicate table",
    (body: string) =>
      body.replace("</body>", '<table class="IISUpullTable"></table></body>'),
  ],
  [
    "unclosed table",
    (body: string) =>
      body.replace("</body>", '<table class="IISUpullTable"></body>'),
  ],
] as const)("All-N-1 rejects %s", (_name, rewrite) => {
  expect(() => parseAlln1Page(rewrite(alln1TestPage()), 1)).toThrow();
});
test("All-N-1 nulls unusable optional photo references without changing source text", () => {
  const page = parseAlln1Page(
    alln1TestPage([
      {
        ...alln1TestRecord,
        imageUrl: "https://example.com/logo.png",
        stock: "2692320",
        position: "V V-11",
      },
    ]),
    1,
  );
  expect(page.records[0]).toMatchObject({
    imageUrl: null,
    stock: "2692320",
    position: "V V-11",
  });
});
