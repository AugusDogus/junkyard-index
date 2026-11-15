# Indian River U-Pull-It

The default-off `indianriver` source covers Indian River U-Pull-It at 4600 45th St, Vero Beach FL 32967. The native owner links its complete inventory. Census independently matched the exact address; the coordinates represent an address-range point, not a rooftop point. This is one Florida provider credit.

The November 15 UTC opening and closing captures each contain three pages, with 500, 500 and 61 native rows. The collector replays all eight actual documents, including owner closure. Of 1,061 rows, it accepts 1,049 donors, rejects seven and identifies five benign duplicate observations. Required identities, native row IDs, order, multiplicities and totals close without drift. Valid rejected VIN/serial observations remain present for reconciliation. Conflicting optional dates become null.

The native Row column contains VINs and supported older serials. It does not establish yard position. Shared paperwork links do not identify individual donors, so search results and notifications direct users to VIN/serial matching in the real searchable inventory. Stock, color and other absent optional metadata remain null.

Durable collection uses eight GETs per chunk and an 8 MiB serialized checkpoint limit. The client uses a 20-second request/body deadline, a serial 2.5-second completed-request gap, no retries and no automatic redirects. Published slashless pagination controls were verified to redirect only to the corresponding canonical slash URL; requests use those verified destinations. All census and owner closing controls must pass before callbacks.

The source retains the 10% rejection, 25% duplicate and 50% previous-count guards, with a census-grounded 900-donor minimum. Durable validation checks prior published counts before reconciliation. It remains disabled pending rollout approval. Native captures, geocoding, accounting and replay evidence are in `.scratchpad/provider-coverage/nov14-provider-goal/research/ga_fl_al/refill/`.

```sh
bun run soak:sources -- --sources=indianriver --cycles=1
```
