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

`searches-2026-11-18.json.br` holds 3 raw native searches for Set Date
2026-11-18 as `{ url, body }`, captured live on November 21, 2026 (HTTP 200,
15:38 to 15:50 UTC). The yards set about 580 donors that day, more than one
search page holds:

- `/inventory/ANY/ANY/?k=1&id=ANY&search=2026-11-18`: capped at exactly 500
  cards (396 Fredericksburg, 104 Stafford), with no continuation.
- `/inventory/ANY/ANY/?k=1&id=TT87&search=2026-11-18`: 412 cards, all
  Fredericksburg, with Fredericksburg selected and `id=TT87` in the form.
- `/inventory/ANY/ANY/?k=1&id=UU81&search=2026-11-18`: 169 cards, all
  Stafford, with Stafford selected and `id=UU81` in the form.

`make-searches-2026-11-16.json.br` holds 4 raw native Fredericksburg searches
for Set Date 2026-11-16 as `{ url, body }`, all HTTP 200. Fredericksburg set
over 500 donors that day, so its yard search is capped and is split by make:

- `/inventory/ANY/ANY/?k=1&id=TT87&search=2026-11-16`: capped at exactly 500
  cards, all Fredericksburg (captured November 22, 2026, 14:08 UTC). Repeating
  it with `&pagenum=2` returned the same 500 cards.
- `/inventory/FORD/ANY/?k=1&id=TT87&search=2026-11-16`: 83 cards, all FORD,
  with `var setMake = "FORD"` and the make path as the form action (14:08 UTC).
- `/inventory/LAND_ROVER/ANY/?k=1&id=TT87&search=2026-11-16`: 3 LAND ROVER
  cards with `var setMake = "LAND_ROVER"`, which verifies the underscore make
  path (23:25 UTC).
- `/inventory/DE_SOTO/ANY/?k=1&id=TT87&search=2026-11-16`: the native empty
  answer, "No Results Found", with no search form, `var setMake = "DE_SOTO"`
  and `var urgID = "TT87"` (23:25 UTC).

`pickapartva-ties.test.ts` reads these live make searches to verify the make
search contract. The make split itself is exercised on a synthetic catalog
in `pickapartva-recovery.test.ts`.

`make-alias-2026-11-21.json.br` holds 2 raw native Fredericksburg make
searches for Set Date 2026-11-21 as `{ url, body }`, captured live on
November 23, 2026 (HTTP 200, about 06:30 UTC):

- `/inventory/DATSUN/ANY/?k=1&id=TT87&search=2026-11-21`: 47 cards, all
  NISSAN and all Fredericksburg, with `var setMake = "DATSUN"` and the DATSUN
  make path as the form action.
- `/inventory/NISSAN/ANY/?k=1&id=TT87&search=2026-11-21`: the same 47 stocks
  in the same order, with `var setMake = "NISSAN"`. The two pages differ only
  in the make they name.

The native DATSUN search answers for its NISSAN group, so it proves that no
DATSUN donor was set that day while the NISSAN search lists the NISSAN donors.

`searches-2026-11-21.json.br` holds 2 raw native searches for Set Date
2026-11-21 as `{ url, body }`, captured live on November 24, 2026 (HTTP 200,
about 18:35 UTC). Fredericksburg set 568 donors that day and Stafford none:

- `/inventory/ANY/ANY/?k=1&id=ANY&search=2026-11-21`: capped at exactly 500
  cards, all Fredericksburg and all set on 2026-11-21, model years 2024 down
  to 2007 (SHA-256 of the body
  `ab26370a7190baff7756437e34593913af89d5a59f755840da4376f9a5c86657`).
- `/inventory/ANY/ANY/?k=1&id=UU81&search=2026-11-21`: the native empty
  answer, "No Results Found", with no search form, Stafford selected,
  `var setMake = "ANY"` and `var urgID = "UU81"` (SHA-256
  `95cc7e8362aca870a45cbb8cbac3a9656d458f50e38754d1e42d465c2a649b7e`). The
  November 24, 07:00 UTC production run rejected this answer as "unfiltered
  search controls are missing".
