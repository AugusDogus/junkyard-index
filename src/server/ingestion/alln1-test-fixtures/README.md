Captured November 16, 2026 from Grandpa John's official root and U-Pull
inventory. All acquisition requests were serial with 3.5 seconds between
responses. No image bytes, private endpoints or production writes were used.

`grandpajohns.json.br` contains five complete raw responses: opening owner,
500-row first page, 152-row second page, separately fetched closing owner
and separately fetched closing first page. The production connector accepts
636 donors, rejects 16 invalid identities (including eight check-digit failures) and reports no exclusions or
duplicates. Tests reuse opening captures only for extra resume anchors.

`grandpajohns-vin-search.html.br` preserves the native GET search returning
one donor for `1FMCU9GX9GUC13987`. `grandpajohns-geocode.json` preserves the
Census exact-address match for 1746 Velp Avenue, Green Bay, WI 54303.
`qualification-requests.json.gz` records all seven live requests, including
the geocoder and search. Tests never contact the provider or geocoder.

`alln1-cache.json.br` contains eight live All-N-1 responses from November 19,
2026 with their cache headers: the canonical cached page 1 (HIT, age 145,950),
cached page 2 (HIT, age 120,868) and fresh page 3, the root (read as
published, HIT, age 1,614), three pages requested with unique `cb` nonces
(MISS, age 0) and the cache-busted search for Set Date 2026-08-28 (MISS, 16
rows). The fresh pages repeat stock 261947 across the page 1/2 boundary and
hide 261948, which that search lists.
