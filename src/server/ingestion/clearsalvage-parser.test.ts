import { expect, test } from "bun:test";
import {
  parseClearsalvageCatalog,
  parseClearsalvageDetail,
} from "./clearsalvage-parser";
import { clearsalvageSaved } from "./clearsalvage-test-fixtures";

const pages = () =>
  clearsalvageSaved.opening.map((response) =>
    parseClearsalvageCatalog(
      response.raw,
      response.url,
      new Headers(response.headers),
    ),
  );

test("Clear parses the actual 100+83 native roster and primary fields without related-card fallback", () => {
  const catalog = pages();
  expect(catalog.map((page) => page.posts.length)).toEqual([100, 83]);
  const posts = catalog.flatMap((page) => page.posts);
  expect(new Set(posts.map((post) => post.id)).size).toBe(183);
  const records = clearsalvageSaved.donors.map((donor) => {
    const post = posts.find((post) => post.url === donor.url);
    if (!post) throw new Error("Saved native post is missing");
    return parseClearsalvageDetail(donor.raw, post);
  });
  expect(
    records.find((record) => record.post.id === 5190)?.claims.model,
  ).toEqual([""]);
  expect(records.find((record) => record.post.id === 5190)?.claims.vin).toEqual(
    [""],
  );
  expect(
    records.find((record) => record.post.id === 5229)?.claims.make,
  ).toEqual(["PATHFINDER"]);
  expect(
    records.find((record) => record.post.id === 5016)?.claims.make,
  ).toEqual(["OLDMOBILE"]);
  expect(
    records.find((record) => record.post.id === 5098)?.claims.make,
  ).toEqual(["NISSIAN"]);
});

test("Clear rejects incomplete or contradictory native roster pagination and identities", () => {
  const response = clearsalvageSaved.opening[0];
  if (!response) throw new Error("Saved native response is missing");
  const parse = (raw: string, headers = new Headers(response.headers)) =>
    parseClearsalvageCatalog(raw, response.url, headers);
  const rows: unknown = JSON.parse(response.raw);
  if (!Array.isArray(rows)) throw new Error("Expected saved native rows");
  expect(() => parse(JSON.stringify(rows.slice(1)))).toThrow();
  expect(() =>
    parse(JSON.stringify([rows[0], ...rows.slice(0, -1)])),
  ).toThrow();
  const bad = new Headers(response.headers);
  bad.set("x-wp-total", "99");
  expect(() => parse(response.raw, bad)).toThrow();
  bad.set("x-wp-totalpages", "3");
  expect(() => parse(response.raw, bad)).toThrow();
  bad.set("link", '<https://example.com/>; rel="next"');
  expect(() => parse(response.raw, bad)).toThrow();
});

test("Clear requires complete HTML, canonical identity and the primary native post", () => {
  const donor = clearsalvageSaved.donors[0];
  const post = pages()
    .flatMap((page) => page.posts)
    .find((post) => post.url === donor?.url);
  if (!donor || !post) throw new Error("Saved native donor is missing");
  for (const raw of [
    donor.raw.replace(/<\/html>$/, ""),
    donor.raw.replace("postid-" + post.id, "postid-1"),
    donor.raw.replace('href="' + post.url + '"', 'href="https://example.com/"'),
  ])
    expect(() => parseClearsalvageDetail(raw, post)).toThrow();
});
