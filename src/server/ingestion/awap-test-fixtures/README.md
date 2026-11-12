# AWAP saved census

`saved-census.json.gz` contains unmodified native About HTML and eight native
Cars at Yard listing bodies, plus the independently prepared 183-donor oracle.
`source-pins.json` records original paths, byte lengths and SHA-256 values.
The archive is deterministic gzip with mtime zero. No provider request generated
these fixtures or runs during replay tests.

The first listing body was captured earlier and explicitly reused with the
seven later pages. All advertise 183 donors; the native page counts are seven
times 25 plus eight. This represents the retained finite source boundary,
without an atomic-snapshot claim.

Oracle provenance: `.scratchpad/coverage/parallel-mi-oh-wi/awap-application-review01/source183-oracle.json`,
SHA-256 `30d6db4a91b33164ab4d47e55d9003fc5236e9eb0fe7aaa200ec0f3a64532da9`.
Native 183-row source manifest SHA-256:
`a30aa5f0e245bfd701db5a90c39c9e0c4df5486bc3b6dfd0ae279dd69fe031fc`.
Final independent source/physical/dedup review SHA-256:
`840998ea363c0ac00e377a5ff03573eebae21d4011314de935fde3ee08cc4e59`.
