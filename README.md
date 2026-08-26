# Junkyard Index

Search across multiple salvage yard inventory locations nationwide.

Currently indexes salvage yards from:

- [LKQ Pick Your Part](https://www.pyp.com)
- [Row52 / Pick-n-Pull](https://row52.com)
- [AutoRecycler](https://app.autorecycler.io)

## Features

- **Multi-source Search**: Search across multiple salvage yard networks simultaneously
- **Advanced Filtering**: Filter by make, color, year, state, and specific yards
- **Real-time Results**: Fast, concurrent searches with live result updates
- **Vehicle Details**: Complete vehicle information with images and direct links
- **Shareable URLs**: All filters and search state preserved in the URL
- **Saved Searches**: Save and quickly reload your favorite searches

## Tech Stack

- [Next.js](https://nextjs.org) - React framework with App Router
- [TypeScript](https://www.typescriptlang.org) - Static type checking
- [Tailwind CSS](https://tailwindcss.com) - Utility-first styling
- [shadcn/ui](https://ui.shadcn.com) - Accessible UI components
- [tRPC](https://trpc.io) - End-to-end type-safe APIs
- [Algolia](https://www.algolia.com) - Search index and InstantSearch UI
- [Drizzle ORM](https://orm.drizzle.team) + [Turso](https://turso.tech) (libSQL) - Vehicle data and ingestion metadata
- [Vercel Workflow](https://vercel.com/workflows) - Durable ingestion, Algolia projection, and search alerts
- [Effect](https://effect.website) - Ingestion pipeline errors and concurrency
- [nuqs](https://nuqs.47ng.com) - Type-safe URL search params
- [better-auth](https://better-auth.com) - Authentication

## Getting Started

1. Clone the repository
2. Install dependencies: `bun install`
3. Run the development server: `bun dev`
4. Open [http://localhost:3000](http://localhost:3000)

### OAuth from localhost and previews

Discord only needs `https://junkyardindex.com/api/auth/callback/discord`
registered as its callback URL. Better Auth uses the existing
Vercel production URL as that origin and proxies the callback back to localhost
and Vercel preview deployments. Local development falls back to
`NEXT_PUBLIC_APP_URL` for the production origin.

Set `OAUTH_PROXY_SECRET` to the same random value of at least 32 characters in
local, Preview, and Production environments.

For a stable HTTPS local URL, run `portless` from the repository root and open
`https://junkyard-index.localhost`. Linked worktrees receive their own
`*.junkyard-index.localhost` URL automatically.

## License

This project is open source and available under the [MIT License](LICENSE).
