import { expect, test } from "bun:test";
import robots from "~/app/robots";
import sitemap from "~/app/sitemap";

// Admin pages 404 for everyone but admins. Listing /admin anywhere public,
// even as a robots.txt disallow, would tell visitors it exists.
test("robots.txt and the site sitemap never mention /admin", () => {
  expect(JSON.stringify(robots())).not.toContain("/admin");
  expect(JSON.stringify(sitemap())).not.toContain("/admin");
});

// Next.js sends a static `metadata` export (title, og:title) in a non-admin's
// 404 flight data even though the page itself 404s. Admin segments must use
// a gated generateMetadata (adminMetadata) instead.
test("no admin page or layout exports static metadata", async () => {
  const root = new URL("../../app/admin/", import.meta.url).pathname;
  const files = await Array.fromAsync(
    new Bun.Glob("**/{page,layout}.tsx").scan(root),
  );
  expect(files).toContain("page.tsx");
  for (const file of files) {
    const source = await Bun.file(`${root}${file}`).text();
    expect({
      file,
      exportsMetadata: /export const metadata\b/.test(source),
    }).toEqual({ file, exportsMetadata: false });
  }
});
