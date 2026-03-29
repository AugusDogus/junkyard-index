# Junkyard Index

Salvage yard vehicle search aggregator built with Next.js 16, TypeScript, Turso (libSQL), Algolia, tRPC, and Drizzle ORM.

## Cursor Cloud specific instructions

### Required secrets

All required environment variables are injected as secrets (see `src/env.js` for the full schema). The app uses `@t3-oss/env-nextjs` with Zod validation — if any required var is missing the dev server will crash on startup. Set `SKIP_ENV_VALIDATION=1` to bypass validation (useful for running lint/typecheck only), but the app will error at runtime for any page that touches the DB or external services.

### Running the dev server

```
bun run dev          # next dev --turbo on port 3000
```

The homepage queries the Turso database for live stats; it will 500 if the DB is unreachable or the schema is not pushed.

### Lint / Format / Typecheck / Test

```
bun run lint         # oxlint .
bun run format:check # oxfmt --check .
bun run typecheck    # tsc --noEmit (prefix with SKIP_ENV_VALIDATION=1 if secrets aren't available)
bun test src         # bun test runner — all unit/integration tests
```

- `bun run check` combines lint + typecheck in one command.
- Tests do not require env vars or a running database.
- `format:check` currently reports 39 files with formatting issues; these are pre-existing.

### Database

- Uses Turso (remote libSQL) via `drizzle-orm/libsql/web`. The client in `src/lib/db.ts` uses the **HTTP** transport (`@libsql/client/web`).
- Schema is defined in `schema.ts` at the repo root.
- `drizzle-kit push` requires real `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN` (the drizzle config imports from `src/env.js` which validates).

### Key gotchas

- The `next.config.js` imports `./src/env.js` at the top level, so env validation runs on every `next build`/`next dev` unless `SKIP_ENV_VALIDATION=1` is set.
- Port 3000 can get stuck if a previous dev server wasn't cleanly shut down; delete `.next/dev/lock` and kill stale node processes if you see "is another instance of next dev running?".
- The Algolia search on `/search` requires valid `NEXT_PUBLIC_ALGOLIA_APP_ID` and `NEXT_PUBLIC_ALGOLIA_SEARCH_API_KEY` to return results — dummy values will render an empty search.
