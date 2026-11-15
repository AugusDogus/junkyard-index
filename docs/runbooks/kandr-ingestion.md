# K&R Truck Parts

The default-off `kandr` source covers K&R Truck Parts / West Michigan International, 840 Interchange Drive, Holland MI 49423. Native supplier 6483483/store 1 binds every donor to this yard. Its five western Michigan branches count as one provider. Michigan Truck Parts in Westland is a separate operator.

The November 15, 2026 UTC census contains three Vehicles For Parts and 46 Dismantled Vehicles entries. All 49 primary details have native VIN and literal year/make/model. Forty-eight qualify. The refrigerator cabinet listing 81643 is rejected, and its valid VIN `3HSDJSJR0DN170483` remains protected presence evidence. There are zero duplicate vehicles. All three closing inventory regions match their openings. The separate Vehicles For Sale category is excluded.

The collector emits one closed, validated batch. Shared durable wiring stages the Holland yard only with that complete batch. A terminal resume emits no inventory or yard. Shared validation enforces a 40-donor floor and the existing rejection, duplicate and previous-count safeguards. Native individual detail URLs remain search and alert destinations. Optional metadata stays nullable.

Chunks allow eight serial GETs. One module-wide gate holds through full request, body and transport cleanup, then a 2.5-second completed gap, including failures. Requests have a combined 20-second deadline, a 2 MiB body limit, manual redirects and zero retries. Chunks have a four-minute deadline. Whole-run limits are 512 GETs and 128 MiB; validated wire checkpoints are bounded to 4 MiB. Failure preserves prior inventory and the last validated checkpoint.

The Holland point, 42.740238356939, -86.071435768538, is Census exact-address street-range interpolation (868 through 700), not rooftop or parcel precision.

Native evidence is in `.scratchpad/provider-coverage/nov14-provider-goal/research/oh_mi_wi/refill04/`. Root verification replays the 56 required dated responses through the production client, durable dispatcher and codecs without live HTTP. It verifies complete yard staging, the protected rejected VIN and shared source validation. See `kandr-root-verification.json` in the goal directory.

The read-only soak counts and discards inventory:

```sh
bun run soak:sources -- --sources=kandr --cycles=1
```
