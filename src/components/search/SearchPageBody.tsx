import type { ReactNode } from "react";

/**
 * /search's body: its one heading and intro, then the search. The server
 * renders the heading outside the search's Suspense boundary, so every
 * response carries it exactly once, and crawlers, which never get a server
 * search (src/lib/search-server-render.ts), read it as the page's text. It
 * stays screen-reader text, in a labelled region since the search's <main>
 * renders inside the boundary: visitors see the search itself.
 */
export function SearchPageBody({ children }: { children: ReactNode }) {
  return (
    <>
      <section aria-labelledby="search-heading" className="sr-only">
        <h1 id="search-heading">Search salvage yard inventory</h1>
        <p>
          Search live donor vehicles across salvage yard networks by year, make,
          model and distance, then save a search to hear when a match arrives.
        </p>
      </section>
      {children}
    </>
  );
}
