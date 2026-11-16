Captured November 16, 2026 from Grandpa John's official root and U-Pull
inventory. All acquisition requests were serial with 3.5 seconds between
responses. No image bytes, private endpoints or production writes were used.

`grandpajohns.json.br` contains five complete raw responses: opening owner,
500-row first page, 152-row second page, separately fetched closing owner
and separately fetched closing first page. The production connector accepts
644 donors, rejects eight invalid identities and reports no exclusions or
duplicates. Tests reuse opening captures only for extra resume anchors.

`grandpajohns-vin-search.html.br` preserves the native GET search returning
one donor for `1FMCU9GX9GUC13987`. `grandpajohns-geocode.json` preserves the
Census exact-address match for 1746 Velp Avenue, Green Bay, WI 54303.
`qualification-requests.json.gz` records all seven live requests, including
the geocoder and search. Tests never contact the provider or geocoder.
