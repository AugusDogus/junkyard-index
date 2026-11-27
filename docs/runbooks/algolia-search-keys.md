# Algolia search keys

Browsers search Algolia directly. Until this runbook is done, production
hands every visitor the app's default Search-Only key, unrestricted. That
same key was public in the browser bundle as
`NEXT_PUBLIC_ALGOLIA_SEARCH_API_KEY` for months, and direct API scripts use it
(Python-urllib, curl, `hitsPerPage` 500 to 1,000): 63 of 3,000 logged calls
for Nov 21 to 27, 2026, and 31 of 148 on Nov 27 (21%). Each call spends the
free plan's 10K searches per period.

The fix costs $0 and changes no plan. It gives each use its own search-only
key and retires the leaked one:

| Env var                         | Key                                     | Limits                                               |
| ------------------------------- | --------------------------------------- | ---------------------------------------------------- |
| `ALGOLIA_SEARCH_PARENT_API_KEY` | browser parent, never leaves the server | 400 queries per visitor per hour, 100 hits per query |
| `ALGOLIA_SEARCH_API_KEY`        | server renders and alert matching       | none (Vercel functions share egress IPs)             |

Both keys have only the `search` ACL and read only the search indices of
production, preview and development. `src/server/algolia-api-key-spec.ts`
holds their exact settings and the measurements behind the limits.

Browsers get secured keys minted from the parent (`/api/search-key`), which
inherit its limits. Each secured key carries a hashed `userToken`, so Algolia
counts the hourly limit per account or visitor IP, not per shared IP. Free
keys also pin the first 24 results. The busiest real visitor in Nov 21 to 27
made 104 calls (171 queries) in an hour, and results pages ask for 24 hits,
so buyers stay well under both limits.

## Before you start

- Every command below calls `/1/keys` only. Algolia does not bill those as
  searches. Never run a search to check a key.
- The script needs the **Admin API key** (Algolia dashboard, Settings, API
  Keys) in `ALGOLIA_ADMIN_API_KEY` for that one shell. It never prints key
  values; it names keys by fingerprint (first 10 hex of their SHA-256).

```sh
# bash/zsh
read -rs ALGOLIA_ADMIN_API_KEY && export ALGOLIA_ADMIN_API_KEY
# fish
read -s -x ALGOLIA_ADMIN_API_KEY
```

## Steps

1. **Record the before state.**
   `bun scripts/algolia-search-keys.ts show`
   On Nov 27, 2026: the leaked Search-Only key `e29ed8c451` has ACL
   `search,listIndexes,settings`, no index, rate or hit limits, validity 0.
   The write key is `b885213b1e`. `ALGOLIA_SEARCH_PARENT_API_KEY` is unset.

2. **Create the two keys.**
   `bun scripts/algolia-search-keys.ts create ~/.config/junkyard-index/algolia-new-keys.env`
   It writes both values to that file (mode 0600) and prints their settings.
   Nothing uses them yet. Undo:
   `bun scripts/algolia-search-keys.ts delete-created ~/.config/junkyard-index/algolia-new-keys.env`

3. **Point every Vercel environment at them** (Production, Preview and
   Development share this Algolia app, so all three change):

   ```sh
   F=~/.config/junkyard-index/algolia-new-keys.env
   for target in production preview development; do
     for name in ALGOLIA_SEARCH_PARENT_API_KEY ALGOLIA_SEARCH_API_KEY; do
       grep "^$name=" "$F" | cut -d'"' -f2 | tr -d '\n' |
         vercel env add "$name" "$target" --force --sensitive
     done
   done
   ```

   Development does not take `--sensitive`; rerun its two lines without it if
   the CLI refuses. Then redeploy production (merge to `main`, or
   `vercel redeploy <current production URL> --target production`).

4. **Check the deploy without searching.**
   - Browsers get secured keys:
     `curl -s https://junkyardindex.com/api/search-key | bun -e 'const g = await Bun.stdin.json(); const d = Buffer.from(g.apiKey, "base64").toString(); console.log("secured", /^[0-9a-f]{64}/.test(d), d.slice(64).replace(/userToken=[^&]*/, "userToken=<hash>"))'`
     must print `secured true` with `restrictIndices`, `validUntil`, `userToken`
     and the free page pins.
   - Server renders and alerts: the next `searchAlertCheckWorkflow` run and
     Sentry show no Algolia 403. One owner search on `/search` (desktop and
     phone) is the only real search this needs.
   - `bun scripts/algolia-search-keys.ts show` lists the two new keys.

   Undo before step 5: Instant Rollback in the Vercel dashboard (the previous
   deployment keeps its old env), or set `ALGOLIA_SEARCH_API_KEY` back to the
   old key (it is `NEXT_PUBLIC_ALGOLIA_SEARCH_API_KEY` in the primary
   checkout's `.env`), remove `ALGOLIA_SEARCH_PARENT_API_KEY`, and redeploy.

5. **Retire the leaked key**, at least 15 minutes after step 4 so open tabs
   have renewed onto secured keys (a tab that still holds the old key renews
   on its first refusal anyway):
   `bun scripts/algolia-search-keys.ts retire e29ed8c451 ~/.config/junkyard-index/algolia-search-key-backup.json`
   It refuses while production still hands browsers a plain key, and refuses
   any key that can write. It saves the key's settings to the backup file
   (mode 0600), restricts the key to a non-existent index with only `search`,
   and prints the after state.

   **Undo (takes effect in seconds):**
   `bun scripts/algolia-search-keys.ts restore ~/.config/junkyard-index/algolia-search-key-backup.json`

   If Algolia refuses to edit the default Search-Only key, the key is
   unchanged. Then regenerate it in the dashboard (API Keys, Search-Only API
   Key, Regenerate). That cannot be undone, but after step 4 nothing of ours
   uses it.

6. **Local checkouts.** Replace `ALGOLIA_SEARCH_API_KEY` in the primary
   checkout's `.env.local` with the new server key, and delete the unused
   `NEXT_PUBLIC_ALGOLIA_SEARCH_API_KEY` from `.env`, `.env.local` and Vercel
   (`vercel env rm NEXT_PUBLIC_ALGOLIA_SEARCH_API_KEY`). No code reads it.

## Expected effect

- Cost: $0 a month. No plan change, no new service.
- Searches saved: the direct scripts stop once the leaked key is retired,
  unless they switch to `/api/search-key`, where they get 24 hits per call and
  the hourly limit. At Nov 27's rate (31 a day) that is about 700 of the
  period's remaining 10K budget by Dec 20; at the Nov 21 to 27 average
  (about 10 a day), about 230.
- The hourly limit does not slow today's scripts (one or two calls per IP per
  hour). It caps a future loop: without it, one script could spend the whole
  period in an afternoon.
- A visitor over the limit gets HTTP 429 from Algolia until the hour rolls
  over; `/search` shows its generic error.
