# Junkyard Index

Salvage yard vehicle search aggregator built with Next.js 16, TypeScript, Turso (libSQL), Algolia, tRPC, and Drizzle ORM.

## Development environment instructions

### Required secrets

All required environment variables are injected as secrets (see `src/env.js` for the full schema). The app uses `@t3-oss/env-nextjs` with Zod validation — if any required var is missing the dev server will crash on startup. Set `SKIP_ENV_VALIDATION=1` to bypass validation, but the app will error at runtime for any page that touches the DB or external services.

### T3 Code worktree setup

- Import `Setup Worktree` from `t3.json` once in T3 Code's project Actions and enable automatic worktree setup. It installs dependencies and links the primary checkout's ignored environment files into new worktrees.

### Running the dev server

```sh
portless # preferred: branch-scoped HTTPS URL such as https://my-branch.junkyard-index.localhost
```

- Always use Portless for local browser QA and authentication unless the user explicitly asks for a raw port. It sets `PORTLESS_URL`, avoids collisions, and gives Better Auth and OAuth a stable origin.
- `t3.json` exposes the same command as the `Dev Server` action.
- Use the exact URL printed by Portless for browser navigation. Do not substitute `localhost:<port>`.
- `bun run dev` is only the raw fallback and runs `next dev --turbo` directly.
- The homepage queries the Turso database for live stats; it will 500 if the DB is unreachable or the schema is not pushed.

### Lint / Format / Typecheck / Test

```
bun run lint         # oxlint .
bun run format:check # oxfmt --check .
bun run typecheck    # tsc --noEmit
bun test src         # bun test runner — all unit/integration tests
```

- `bun run check` combines lint + typecheck in one command.
- Tests do not require env vars or a running database.
- `format:check` currently reports 39 files with formatting issues; these are pre-existing.

### Database

- Uses Turso (remote libSQL) via `drizzle-orm/libsql/web`. The client in `src/lib/db.ts` uses the **HTTP** transport (`@libsql/client/web`).
- Schema is defined in `schema.ts` at the repo root.
- Schema changes ship only as generated migrations (`bun run db:generate`). Production and preview builds apply them with `db:migrate` before `next build` (`scripts/vercel-build.ts`). There is no `db:push`: it changes the database outside the journal, so later migrations no longer match it.
- **Expand, then contract.** Old and new deployments share the database during a rollout, and workflow runs stay pinned to the deployment that started them. A migration may only add: tables, nullable or defaulted columns, and indexes. Drop or rename a column or table in a later PR, once no live deployment reads or writes it and no workflow run from an older deployment is still running. To change what a column means, add a new column instead of rewriting the old one.
- **Journal order.** `src/server/migration-journal.test.ts` requires each entry's `idx` to match its position, `when` to strictly increase, a `.sql` file per entry, and an unbroken snapshot `prevId` chain. The libSQL migrator silently skips an entry whose `when` is not after the newest applied migration. When two branches each add a migration, regenerate the one that merges second on top of the other, so it gets the next `idx`, a later `when` and the right `prevId`.
- Make and model pages (`/cars`, its makes and models, and their sitemap) read the `inventory_snapshot` table, never aggregate `vehicle` themselves; yard lists read `yard_inventory`, and state pages count new arrivals from `state_recent_arrival`, which ingestion rebuilds with `yard_inventory`. Deploys store the snapshot after migrating and each ingestion pass refreshes it. Against a fresh database, or one whose vehicles were loaded after migrating, run `bun run inventory:project` once (`--force` if the snapshot is already stored); it reads every vehicle, about a minute, and also rebuilds `state_recent_arrival`.

### Key gotchas

- The `next.config.js` imports `./src/env.js` at the top level, so env validation runs on every `next build`/`next dev` unless `SKIP_ENV_VALIDATION=1` is set.
- Port 3000 can get stuck if a previous dev server wasn't cleanly shut down; delete `.next/dev/lock` and kill stale node processes if you see "is another instance of next dev running?".
- The Algolia search on `/search` requires valid `NEXT_PUBLIC_ALGOLIA_APP_ID` and `ALGOLIA_SEARCH_API_KEY` values to return results. `ALGOLIA_SEARCH_API_KEY` is server-only and search-only. Browsers get secured keys from `/api/search-key`. Those keys are minted from `ALGOLIA_SEARCH_PARENT_API_KEY`, a search-only key with per-visitor limits (`docs/runbooks/algolia-search-keys.md`). Until that key is set, browsers receive `ALGOLIA_SEARCH_API_KEY` unrestricted. Dummy values will render an empty search.

## Repository friction is product work

When a supported Junkyard Index workflow exposes a reproducible defect in Junkyard Index code, or returns an error that leaves a fresh agent unable to recover, keep the failing case and treat the defect as part of the current task. Minimize it and reproduce it against the current default branch before starting a repair. Keep the parent task's code honest instead of hiding the defect with a local workaround. A change that chooses new product semantics, crosses into another repository or submodule, or turns an unsupported request into a feature needs approval first.

For a confirmed Junkyard Index defect, follow [`.agents/skills/repair-repository-friction/SKILL.md`](.agents/skills/repair-repository-friction/SKILL.md). This is standing authorization to fix Junkyard Index code, create or update a dedicated branch and pull request, and babysit its current head until required checks pass and no actionable review thread remains. It does not authorize merging the pull request.

When T3 Code thread orchestration is available and the repair can be separated from the original task, launch a new top-level T3 Code thread with its own isolated worktree using `t3_thread_launch` and an explicit `workspaceStrategy`. This is standing authorization to create that repair thread. Do not assign repair ownership to a subagent. Include the skill, reproduction evidence, scope, and discovering thread ID in the launch message, and retain the returned thread ID for coordination. The discovering agent owns the diagnosis, minimized reproduction, and final retest. The repair thread owns the regression test, root-cause fix, branch, pull request, and review loop. The discovering agent must receive the repair evidence and rerun the original workflow before reporting its task complete. Review subagents within the repair thread remain allowed. Run the same skill directly when T3 Code thread orchestration is unavailable or the work cannot be separated cleanly.
