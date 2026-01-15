# Junkyard Index

Search across all salvage yard inventory locations nationwide. Currently indexes [LKQ Pick Your Part](https://www.pyp.com) and [Row52 / Pick-n-Pull](https://row52.com) yards.

## Features

- **Multi-source Search**: Search across multiple salvage yard networks simultaneously
- **Advanced Filtering**: Filter by make, color, year, state, data source, and specific yards
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
- [Cheerio](https://cheerio.js.org) - Server-side HTML parsing
- [nuqs](https://nuqs.47ng.com) - Type-safe URL search params
- [better-auth](https://better-auth.com) - Authentication

_This project was initially scaffolded using [create-t3-app](https://create.t3.gg/)._

## Getting Started

1. Clone the repository
2. Install dependencies: `bun install`
3. Run the development server: `bun dev`
4. Open [http://localhost:3000](http://localhost:3000)

## License

This project is open source and available under the [MIT License](LICENSE).
