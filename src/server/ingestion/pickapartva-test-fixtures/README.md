`census-2026-11-12.json.br` holds 19 raw HTML responses as `{ url, body }`,
in request order, with no network access in tests:

- The 15 catalog pages of the November 12, 2026 census
  (`/inventory/ANY/ANY/?k=1&id=ANY&pagenum=1` to `15`), captured serially
  from 10:21 to 10:25 UTC: 7,449 cards, 500 per page and 449 on page 15.
- The closing reads of pages 1, 2 and 15 from the same run.
- The native search `/inventory/ANY/ANY/?k=1&id=ANY&search=2026-10-16`,
  captured live on November 19, 2026: HTTP 200, 191 cards all set on
  2026-10-16, empty pagination toolbars and the date reflected in the form.

The census repeats 18 cards across page boundaries that split Set Date ties
at six dates. Only the 2026-10-16 search was captured. The test builds the
other five searches from the captured search page around that census's own
cards for the date plus one donor per repeated card: the real donor
PAP174600 (from the live November 19 page 8) for 2026-10-20 and synthetic
`PAP99000N` donors otherwise.
