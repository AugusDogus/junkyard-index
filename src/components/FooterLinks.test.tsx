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

test("the footer links the chains hub", () => {
  const html = renderToStaticMarkup(<FooterLinks />);
  expect(html).toMatch(/href="\/chains"[^>]*>Chains<\/a>/);
});

test("the footer's search link doesn't prefetch the search page, which renders on every request", async () => {
  // Run in a child process so the next/link mock stays out of other test files.
  const child = Bun.spawn(
    [
      process.execPath,
      "--eval",
      `
      import { mock } from "bun:test";
      import { createElement } from "react";
      import { renderToStaticMarkup } from "react-dom/server";
      const links = [];
      mock.module("next/link", () => ({
        default: ({ href, prefetch, children }) => {
          links.push([href, prefetch ?? "default"]);
          return createElement("a", { href }, children);
        },
      }));
      const { FooterLinks } = await import(${JSON.stringify(new URL("./FooterLinks.tsx", import.meta.url).pathname)});
      renderToStaticMarkup(createElement(FooterLinks));
      process.stdout.write(JSON.stringify(Object.fromEntries(links)) + "\\n");
    `,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [output, errors, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0) throw new Error(`child exited ${exitCode}: ${errors}`);
  const prefetch: unknown = JSON.parse(output.trim().split("\n").at(-1) ?? "");
  expect(prefetch).toMatchObject({ "/search": false, "/map": "default" });
});
