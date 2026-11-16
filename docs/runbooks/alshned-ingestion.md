# Alshned ingestion

See the current [source flags and census floors](provider-coverage-go-live.md).

The `alshned` source covers Alshned Auto Parts, 1231 Hayes Blvd Suite B, Bristol PA 19007. The native contact page and donor pages publish the same operator, address and phone. Coordinates 40.120438479353, -74.856847323102 come from Census exact-address street-range interpolation (1299 through 1221). They do not imply rooftop or parcel precision.

The November 15, 2026 UTC census traverses both native collection pages, all 43 individual donor pages and both independently captured closing collection pages. It accepts 41 donors and retains two required conflicts as rejects, with zero duplicates or exclusions. One donor disagrees on Ram/Dodge; another disagrees on F150/F-150. No inference repairs those claims. All 43 independently valid observed VINs protect presence.

The collector binds each Product, visible heading, VIN claim, vendor and canonical URL to its ordered native donor card. Every opening page, title, vendor, destination, count and pagination control must match closing. Contradictory active and removed claims quarantine the entire identity. One vehicle batch and one yard emit after complete closing and source quality checks. A terminal resume emits no inventory, accounting or presence and makes no HTTP requests, even after its run expires.

Shared validation enforces a 13-donor floor, the existing 10% rejection and 25% duplicate ceilings, and the previous-count drift guard. Native donor URLs are the vehicle destinations. Unsupported optional photos become null; source model descriptions retain their native trim and color wording.

Chunks allow 12 serial GETs. Work stops between requests after 60 seconds, with a 90-second hard chunk deadline. A module-wide gate holds through transport/body cleanup and a completed 2.5-second gap, including failures. Requests use manual redirects, no retries, a combined 25-second deadline and a 2 MiB decoded-body cap. Whole-run limits are two hours and 512 MiB, with at most 1,000 collection pages and 24,000 donors. Checked cursors are bounded to 8 MiB. Failures preserve prior inventory and the last validated checkpoint.

Evidence lives under `.scratchpad/provider-coverage/nov14-provider-goal/research/pa_md_wv/refill09/`. The independent offline replay validates all 48 original response receipts and bodies through the production client, shared gate, durable dispatcher and checked cursor codecs. See `alshned-root-verification.json` and `alshned-local-admission.json` in the goal directory. Only completed gap sleeps are virtualized; no live HTTP is used.

The count-only soak discards inventory and preserves a paused checkpoint at its GET cap:

```sh
bun run soak:sources -- --sources=alshned --cycles=1
```

This command makes live requests. It is an operator diagnostic, not part of offline admission. Qualification does not enable `ingestion-source-alshned`.
