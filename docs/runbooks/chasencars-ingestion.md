# Chase N Cars

The default-off `chasencars` source covers the self-service yard at 6471 State Highway 66, Tulsa OK 74131. Native home and yard pages explicitly bind the inventory to its operator and physical yard. Its complete server-rendered table uses local DOM pagination, with no remote inventory loader.

The November 15 UTC census contains 680 rows: 661 accepted donors, 19 required-field rejects, zero duplicates and zero stock conflicts. Three supported older serials pass the existing identity helper. The inventory, yard and owner each have a separately dated closing capture. All three match their opening bytes. Actual opening capture order was owner, inventory, yard; the collector reads owner, yard, inventory before all closing controls. Saved bytes and original chronology remain unchanged.

The yard point comes from the actual HTTP302 destination of the native address shortlink. Its `!3d` and `!4d` fields identify 36.0699802, -96.0607632 at the exact address. The different map viewport coordinates are not used. No Google destination or search request was needed.

All inventory, rejected identities, accounting and yard staging are deferred until six controls and whole-source quality checks pass. Durable validation requires the terminal checkpoint, a 550-donor minimum, and the existing 10% rejection, 25% duplicate and 50% previous-count guards. Optional photos, color, stock, dates and position remain nullable. No individual donor URLs are published; search and alerts direct users to the inventory table with VIN/stock matching guidance.

GETs are serial with a 1.6-second completed gap, no retries or redirect following, and a combined 20-second request/body deadline. The run has six GETs, a 12 MiB cumulative byte bound, 2 MiB response and checkpoint limits, and a three-minute chunk deadline. Durable chunks allow six GETs. Source failures preserve prior inventory and the last validated checkpoint.

Evidence is in `.scratchpad/provider-coverage/nov14-provider-goal/research/ks_ok_nm_tx/chasencars-native-proof.json` and its referenced actual responses. The read-only soak counts and discards inventory:

```sh
bun run soak:sources -- --sources=chasencars --cycles=1
```
