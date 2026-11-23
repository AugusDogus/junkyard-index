import { expect, test } from "bun:test";
import robots from "~/app/robots";
import sitemap from "~/app/sitemap";

// Admin pages 404 for everyone but admins. Listing /admin anywhere public,
// even as a robots.txt disallow, would tell visitors it exists.
test("robots.txt and the site sitemap never mention /admin", () => {
  expect(JSON.stringify(robots())).not.toContain("/admin");
  expect(JSON.stringify(sitemap())).not.toContain("/admin");
});
