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
- [Trigger.dev](https://trigger.dev) - Scheduled ingestion, Algolia projector, and search alerts
- [Effect](https://effect.website) - Ingestion pipeline errors and concurrency
- [nuqs](https://nuqs.47ng.com) - Type-safe URL search params
- [better-auth](https://better-auth.com) - Authentication

## Getting Started

1. Clone the repository
2. Install dependencies: `bun install`
3. Run the development server: `bun dev`
4. Open [http://localhost:3000](http://localhost:3000)

## License

This project is open source and available under the [MIT License](LICENSE).
