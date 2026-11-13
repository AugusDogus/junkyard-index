import { gunzipSync } from "node:zlib";

/** Native05 ownership profile and the byte-stable native15/16/17 census.
 * Capture manifest SHA256: 3df8cfabe3e2a4de35284444ddc16c4067affac035d29d79bf9cecece1135fb9.
 */
export const bigtruckpageFixture = async (page: number | "profile") =>
  gunzipSync(
    await Bun.file(
      new URL(
        `./bigtruckpage-test-fixtures/${page === "profile" ? "profile" : "page-" + page}.html.gz`,
        import.meta.url,
      ),
    ).arrayBuffer(),
  ).toString("utf8");
