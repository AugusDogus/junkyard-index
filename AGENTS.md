# Junkyard Index

Salvage yard vehicle search aggregator built with Next.js 16, TypeScript, Turso (libSQL), Algolia, tRPC, and Drizzle ORM.

## Development environment instructions

### Required secrets

All required environment variables are injected as secrets (see `src/env.js` for the full schema). The app uses `@t3-oss/env-nextjs` with Zod validation — if any required var is missing the dev server will crash on startup. Set `SKIP_ENV_VALIDATION=1` to bypass validation, but the app will error at runtime for any page that touches the DB or external services.

### T3 Code worktree setup

- Import `Setup Worktree` from `t3.json` once in T3 Code's project Actions and enable automatic worktree setup. It installs dependencies and links the primary checkout's ignored environment files into new worktrees.

### Running the dev server

```
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
- `drizzle-kit push` requires real `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN` (the drizzle config imports from `src/env.js` which validates).

### Key gotchas

- The `next.config.js` imports `./src/env.js` at the top level, so env validation runs on every `next build`/`next dev` unless `SKIP_ENV_VALIDATION=1` is set.
- Port 3000 can get stuck if a previous dev server wasn't cleanly shut down; delete `.next/dev/lock` and kill stale node processes if you see "is another instance of next dev running?".
- The Algolia search on `/search` requires valid `NEXT_PUBLIC_ALGOLIA_APP_ID` and `NEXT_PUBLIC_ALGOLIA_SEARCH_API_KEY` values to return results. The public key must be restricted to search-only access for the vehicle indices. Dummy values will render an empty search.

## Repository friction is product work

When a supported Junkyard Index workflow exposes a reproducible defect in Junkyard Index code, or returns an error that leaves a fresh agent unable to recover, keep the failing case and treat the defect as part of the current task. Minimize it and reproduce it against the current default branch before starting a repair. Keep the parent task's code honest instead of hiding the defect with a local workaround. A change that chooses new product semantics, crosses into another repository or submodule, or turns an unsupported request into a feature needs approval first.

For a confirmed Junkyard Index defect, follow [`.agents/skills/repair-repository-friction/SKILL.md`](.agents/skills/repair-repository-friction/SKILL.md). This is standing authorization to fix Junkyard Index code, create or update a dedicated branch and pull request, and babysit its current head until required checks pass and no actionable review thread remains. It does not authorize merging the pull request.

When delegation is available and the repair can be separated from the original task, dispatch that skill to one subagent in an isolated worktree. The discovering agent owns the diagnosis, minimized reproduction, and final retest. The repair agent owns the regression test, root-cause fix, branch, pull request, and review loop. The discovering agent must receive the repair evidence and rerun the original workflow before reporting its task complete. Run the same skill directly when delegation is unavailable or the work cannot be separated cleanly.
