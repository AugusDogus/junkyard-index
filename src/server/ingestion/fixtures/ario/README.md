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

Follow-up rate-budget probes are recorded in `followup-requests.json`.
`limit-500.json` and `limit-1000.json` preserve Ario's explicit maximum-100
validation. The three `group-*.json.gz` captures show stable opening/closing
items and disjoint 100-rank windows for Samson and Foss Havelock. These five
requests used the previously captured public key, were paced 2.3 seconds apart,
and returned two HTTP 400s and three HTTP 200s, with no 429. No quota-exhaustion
probe was attempted. Tests replay these responses without network access.

November 16 CFC qualification adds `cfc-recycling.json.gz`: five complete
100-rank windows and a separately fetched closing window. Of 422 rows,
407 are accepted and fifteen malformed VINs are rejected unchanged.
`cfc-owner.html.gz` is the official page embedding this native yard and
publishing its exact-address LocalBusiness coordinates. The directory has
no coordinates for CFC. Its native location key uses the yard UUID because
no legacy ID is known.

`cfc-group-21.json.gz` is a live grouped opening probe with all 21 customer
yards, 2,095 items and complete per-yard metadata. CFC fits inside the existing
33-window bound, preserving 37 daily requests and the 48-request hourly cap.
`cfc-qualification-requests.json.gz` records fourteen serial live requests,
including owner discovery and the grouped probe. These fixtures contain no
keys. Tests use saved responses only.
