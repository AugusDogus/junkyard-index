# Landing page Lighthouse audit

The measurements below describe the previous static-overview implementation at `6c3d417`. The current map uses Pigeon Maps with server-rendered tiles and pins, replacing both Leaflet and the static overview. A fresh comparison follows the migration.

Measured September 5, 2026 for PR #71. This is a lab comparison, not a guarantee of identical scores on every run or a field Core Web Vitals assessment.

## Method

- Lighthouse 13.4.1, Chrome 152, sequential runs on the same machine with fresh browser profiles and default simulated throttling.
- Mobile: 412 × 823, device scale 1.75, 4× CPU slowdown. Desktop: 1350 × 940, device scale 1, no CPU slowdown.
- Production baseline: `https://junkyardindex.com`, deployment `tfbf07sk1`. Audited PR: deployment `jfglqrf1u`, commit `6c3d417`. The subsequent mobile control-position and keyboard-focus change was checked separately in the browser.
- Application caches were warm; browser caches were cleared. No development-server scores are used.
- The homepage baseline includes six runs collected during the audit; the final PR has three runs per device. Pricing has three baseline and three PR runs per device. Search has three runs per branch on mobile and one desktop spot check per branch.
- Vercel's preview toolbar is excluded from the final PR runs by applying `x-vercel-skip-toolbar: 1` only to first-party and `vercel.live` requests. Do not apply this header globally: Algolia rejects it in CORS preflight, invalidating search tests. Earlier search runs with the global header were discarded.
- Preview deployments deliberately return `X-Robots-Tag: noindex`. This explains the preview SEO scores (69 on home, 66 on pricing/search). Inspect the individual SEO audits instead of comparing that deployment-policy deduction to production.

## Results

Performance scores are medians, with observed ranges in parentheses.

| Page    | Device  | Production baseline |              PR |
| ------- | ------- | ------------------: | --------------: |
| Home    | Mobile  |          60 (52–67) |      64 (51–67) |
| Home    | Desktop |          97 (94–98) |      98 (95–99) |
| Pricing | Mobile  |          54 (47–71) |      54 (49–55) |
| Pricing | Desktop |          98 (96–98) |      97 (91–99) |
| Search  | Mobile  |          50 (49–68) |      71 (48–72) |
| Search  | Desktop |     91 (single run) | 91 (single run) |

Medians are rounded to whole points. The homepage loading regression is resolved in these measurements. Pricing's one-point desktop difference is within the observed variation; the results do not establish that every score will be equal or higher on every run.

Accessibility and Best Practices both score 100 on all three pages after the fixes. Production SEO scores 100; all preview SEO audits other than indexing permission pass. The pricing heading-order failure was also corrected. The homepage's median layout shift is zero.

## Changes

- Render a lightweight geographic overview and live yard pins in the server HTML. The land outline is about 25 KB before compression and adds no client JavaScript or image request.
- Load Leaflet, its CSS, and map tiles only when someone opens the detailed map or selects a yard. The initial page makes zero map tile requests.
- Preserve the overview while the detailed map loads, and move keyboard focus into the interactive map when the overview control is replaced.
- Keep 24 × 24 pixel click targets around the original small pins. Use retina tiles in the detailed map.
- Keep the Explore control above the pins on small screens.
- Disable speculative search-route prefetching from the moving vehicle cards.
- Use native `details`/`summary` for the FAQ, preserving keyboard interaction and server-rendered answers without FAQ hydration.
- Give the map, recent vehicles, and pricing their own Suspense boundaries for selective hydration.
- Use `h2` plan headings on `/pricing` and `h3` under the homepage's pricing heading.

Mobile performance still has substantial shared JavaScript cost. These changes remove the map's initial loading dependency; they do not make the existing analytics and session-recording startup free. Keep production field metrics under observation after release.

## Map library comparison

Small minified browser builds with React and React DOM externalized, compressed with gzip. These are library measurements, not Lighthouse results for replacement implementations; map data, tiles, and application code are excluded.

| Library           | Version | Gzip bytes | Assessment                                                                                                                                                                                                                                         |
| ----------------- | ------- | ---------: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pigeon Maps       | 0.22.1  |      8,246 | Best candidate for a smaller tiled map. A React 19 server-rendering smoke test produced tiles and a yard overlay. Explicit initial dimensions, eager tile loading, high-density tiles, and interaction/accessibility testing still need attention. |
| Leaflet           | 1.9.4   |     44,239 | Keep for the current on-demand detailed map. It already supports the required interactions and now has no initial-load cost.                                                                                                                       |
| React Simple Maps | 3.0.0   |     53,932 | Suitable for SVG map charts and pan/zoom, but not a replacement for street-level tiled maps. Its declared React peer range stops at React 18.                                                                                                      |
| MapLibre GL JS    | 6.7.0   |    259,888 | WebGL/vector-tile rendering is useful for more advanced maps; this is a larger initial dependency for the current page.                                                                                                                            |

Pigeon's server rendering can improve tile discovery, but switching libraries alone is not an out-of-the-box guarantee of a better Lighthouse score. Prototype it if an immediately interactive tiled map becomes a priority. The current implementation keeps the overview available before JavaScript and preserves the existing detailed map.

References: [Pigeon Map options](https://pigeon-maps.js.org/docs/map/), [React Simple Maps](https://www.react-simple-maps.io/docs/getting-started/), [MapLibre](https://maplibre.org/maplibre-gl-js/docs/), [Leaflet](https://leafletjs.com/reference.html), [Vercel toolbar automation](https://vercel.com/docs/vercel-toolbar/managing-toolbar#disable-toolbar-for-automation), [Lighthouse score variability](https://developer.chrome.com/docs/lighthouse/performance/performance-scoring), [Natural Earth data license](https://www.naturalearthdata.com/about/terms-of-use/).
