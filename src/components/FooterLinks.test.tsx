import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { FooterLinks } from "./FooterLinks";
import HomePage from "~/app/home/page";
import { metadata } from "~/app/request-yard/layout";

test("Home is a permanent redirect and footer links directly to its destination", () => {
  expect(HomePage).toThrow(
    expect.objectContaining({ digest: "NEXT_REDIRECT;replace;/;308;" }),
  );
  const html = renderToStaticMarkup(<FooterLinks />);
  expect(html).toMatch(/href="\/"[^>]*>Home<\/a>/);
  expect(html).not.toContain('href="/home"');
});

test("the footer links to the yard map, which signed-in visitors can reach", () => {
  const html = renderToStaticMarkup(<FooterLinks />);
  expect(html).toMatch(/href="\/map"[^>]*>Yard map<\/a>/);
});

test("request-yard utility form is explicitly noindex", () => {
  expect(metadata.robots).toEqual({ index: false, follow: true });
});
