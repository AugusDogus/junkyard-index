/**
 * /search's one heading and intro, rendered by the server outside the
 * search's Suspense boundary so every response carries it exactly once.
 * Crawlers never get a server search (src/lib/search-server-render.ts), so
 * this is the page text they read. It stays screen-reader text: visitors
 * see the search itself.
 */
export function SearchHeading() {
  return (
    <div className="sr-only">
      <h1>Search salvage yard inventory</h1>
      <p>
        Search live donor vehicles across salvage yard networks by year, make,
        model and distance, then save a search to hear when a match arrives.
      </p>
    </div>
  );
}
