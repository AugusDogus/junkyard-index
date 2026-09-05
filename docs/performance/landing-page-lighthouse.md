# Landing page Lighthouse audit

Measured September 5, 2026 for PR #71. These are lab measurements, not a guarantee of identical scores on every run or a field Core Web Vitals assessment.

## Current map

The homepage now uses Pigeon Maps 0.22.1. Leaflet, the static land outline, and the interaction-only loading stage have been removed.

- Tiles and all yard pins are present in the server HTML. Visible map tiles use high fetch priority. Mobile requests use a smaller initial viewport estimate so the initial document contains the appropriate tiles.
- The map scales within its reserved space before hydration, then adopts its measured dimensions. Its overlay origin and attribution stay fixed to avoid layout shifts.
- The map and marquee retain independent hydration, with their exact space reserved while streaming. This prevents the FAQ from moving when either section arrives.
- Standard-density screens reuse ordinary OSM tiles. High-density screens use four child tiles for each tile area, providing twice the resolution without an unsupported `@2x` endpoint.
- Pins have 24px click targets, 11px circular dots, a small circular hover treatment, and a circular keyboard focus indicator.
- Pan, zoom, reset, yard selection, responsive resizing, and tile-error handling remain available. The selected-yard card stays clear of the controls.

## Method

- Lighthouse 13.4.1 and Chrome 152, sequential runs on the same machine with fresh browser profiles and default simulated throttling.
- Mobile: 412 × 823, device scale 1.75, 4× CPU slowdown. Desktop: 1350 × 940, device scale 1, no CPU slowdown.
- Fresh production baseline: `https://junkyardindex.com`. Pigeon Maps: `https://junkyard-index-sk3svvn85-augies-projects.vercel.app`, commit `c1b4def`. Three homepage runs per device and deployment, with production rerun after the Pigeon measurements.
- Browser caches were cleared. No development-server scores are used.
- Exclude Vercel's preview toolbar by applying `x-vercel-skip-toolbar: 1` only to first-party and `vercel.live` requests. Do not apply it globally: Algolia rejects the header in CORS preflight.
- Vercel preview deployments deliberately return `X-Robots-Tag: noindex`. This explains their SEO deduction. Production SEO is 100.

## Homepage results

Performance scores are medians with observed ranges. These measurements still show a loading regression, especially on mobile. The no-regression requirement is not satisfied.

| Device  | Production | Pigeon Maps |
| ------- | ---------: | ----------: |
| Mobile  | 67 (51–71) |  49 (46–53) |
| Desktop | 97 (91–98) |  93 (92–93) |

Median loading metrics:

| Device / build        |    LCP |     TBT | CLS |
| --------------------- | -----: | ------: | --: |
| Mobile / Production   | 3.55 s | 1149 ms |   0 |
| Mobile / Pigeon Maps  | 6.55 s | 1191 ms |   0 |
| Desktop / Production  | 0.73 s |  128 ms |   0 |
| Desktop / Pigeon Maps | 1.42 s |  131 ms |   0 |

All six Pigeon runs scored 100 for Accessibility and Best Practices, with zero cumulative layout shift. Preview SEO was 69 solely because indexing is disabled; production scored 100.

The smaller map library and stable layout have not eliminated the initial tile-loading cost. Mobile median LCP rose from 3.55 seconds to 6.55 seconds. These results do not establish that the map is ready to ship under the no-regression requirement. No production deployment or merge was performed.

Raw Lighthouse JSON and HTML reports are retained locally under `/tmp/junkyard-lighthouse/verified/`, with prefixes `production-current` and `pigeon-priority` and three numbered runs for each device.

The first Pigeon implementation used the same initial viewport on phones and desktops. That produced large layout shifts and late tile discovery on mobile. Those diagnostic runs are excluded from the final table because they measure the implementation before the hydration fixes.

## Other routes

These measurements were collected during the earlier landing-page audit. The Pigeon migration only changes the homepage map and its scoped styles; pricing and search were not rebenchmarked for this migration.

| Page    | Device  | Production baseline | Redesigned page |
| ------- | ------- | ------------------: | --------------: |
| Pricing | Mobile  |          54 (47–71) |      54 (49–55) |
| Pricing | Desktop |          98 (96–98) |      97 (91–99) |
| Search  | Mobile  |          50 (49–68) |      71 (48–72) |
| Search  | Desktop |     91 (single run) | 91 (single run) |

Scores are rounded medians with observed ranges. Pricing has three runs per branch and device; search has three mobile runs per branch and one desktop spot check per branch. Pricing's one-point desktop difference is within observed variation. Accessibility and Best Practices scored 100 on both pages. Their preview SEO scores were 66 because indexing is disabled.

## Library investigation

Small minified browser builds with React and React DOM externalized, compressed with gzip. These are library measurements, not Lighthouse results for complete replacement implementations. Tiles, map data, and application code are excluded.

| Library           | Version | Gzip bytes | Assessment                                                                                                                             |
| ----------------- | ------- | ---------: | -------------------------------------------------------------------------------------------------------------------------------------- |
| Pigeon Maps       | 0.22.1  |      8,246 | Selected. Small React map with server rendering. Initial viewport sizing and high-density tile handling required explicit integration. |
| Leaflet           | 1.9.4   |     44,239 | Removed. Its client-only initialization delayed tile discovery in the original implementation.                                         |
| React Simple Maps | 3.0.0   |     53,932 | Suitable for SVG map charts, not street-level tiled maps. Declared React peer range stops at React 18.                                 |
| MapLibre GL JS    | 6.7.0   |    259,888 | Larger WebGL/vector-tile engine than this page needs.                                                                                  |

References: [Pigeon Map options](https://pigeon-maps.js.org/docs/map/), [React Simple Maps](https://www.react-simple-maps.io/docs/getting-started/), [MapLibre](https://maplibre.org/maplibre-gl-js/docs/), [Leaflet](https://leafletjs.com/reference.html), [Vercel toolbar automation](https://vercel.com/docs/vercel-toolbar/managing-toolbar#disable-toolbar-for-automation), [Lighthouse score variability](https://developer.chrome.com/docs/lighthouse/performance/performance-scoring).
