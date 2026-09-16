import { expect, test } from "bun:test";
import { parseIPullUPullDirectory } from "./ipullupull-yard-metadata";

const card = (slug: string) =>
  `<figure class="wp-block-image size-full"><a href="/locations/${slug}/"><img alt="Location" /></a></figure>`;
const html = `<html><body>${card("fresno-ca")}${card("pomona-ca")}</body></html>`;

test("only current location cards establish eligibility, not navigation, comments, or script links", () => {
  const directory = parseIPullUPullDirectory(
    html.replace(
      "<body>",
      `<body>
    <nav><a href="/locations/stockton-ca/">Old navigation entry</a></nav>
    <!-- ${card("sacramento-ca")} -->
    <script>const old = '${card("bakersfield-ca")}';</script>`,
    ),
  );
  expect([...directory.keys()]).toEqual(["FRESNO", "POMONA"]);
  expect(directory.get("FRESNO")?.href).toBe(
    "https://ipullupull.com/locations/fresno-ca/",
  );
});

test.each([
  ["empty directory", "<html><body></body></html>"],
  ["missing body end", html.replace("</body>", "")],
  ["missing document end", html.replace("</html>", "")],
  ["partial card", html.replace("</figure>", "")],
  ["unclosed comment", html.replace("</body>", "<!--</body>")],
  ["unclosed script", html.replace("</body>", "<script></body>")],
  ["ambiguous city", html.replace("pomona-ca", "fresno-ny")],
  ["duplicate card", html.replace("pomona-ca", "fresno-ca")],
  ["false href attribute", html.replace("href=", "data-href=")],
  [
    "off-site link",
    html.replace(
      'href="/locations/fresno-ca/"',
      'href="https://example.com/locations/fresno-ca/"',
    ),
  ],
  [
    "credentialed link",
    html.replace(
      'href="/locations/fresno-ca/"',
      'href="https://user:password@ipullupull.com/locations/fresno-ca/"',
    ),
  ],
  [
    "multiple yard links",
    html.replace(
      "</figure>",
      '<a href="/locations/stockton-ca/">Another yard</a></figure>',
    ),
  ],
])(
  "rejects %s instead of treating absent cities as ineligible",
  (_name, content) => {
    expect(() => parseIPullUPullDirectory(content)).toThrow();
  },
);
