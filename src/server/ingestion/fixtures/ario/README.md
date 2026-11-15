Captured November 15, 2026 from Ario's public yard directory and anonymous
`search-inventory` edge function. Requests were serial, paced 2.2 seconds apart.
`requests.json` records URLs, request bodies, status and response size, with no keys.

The gzip files contain the complete per-yard rank windows split from the saved
multi-yard responses. `closing` contains the independently fetched opening page.
The directory keeps only public identity/contact fields and coordinate fields;
yard maps, configuration and unrelated fields are omitted.

Ario counts suppressed rows in `total_matching` and item ranks, but omits them
from `items`. Shelby and Lincolnton demonstrate why `next_offset`, short pages,
and returned count cannot establish completeness. Visit every 100-rank window
through the declared bound. A second opening-page read detects catalog changes.

Beyond-bound empty windows were captured for most yards, but are not used to
prove completion. Live collection stopped when Ario returned its hourly quota.
All in-bound windows and closing pages are captured responses. Tests never
contact Ario.
