# Public vPIC identity responses

`identities.json` contains four unmodified result objects from the live,
read-only production-pattern sample on 2026-11-18. Requests used the public
`DecodeVINValuesBatch` endpoint, 50 VINs per POST, serially with a generic
User-Agent. These are public vehicle identity fields, without credentials or
project/owner metadata. Tests replay this file and never contact vPIC.
