import Link from "next/link";

export function Footer() {
  return (
    <footer className="border-t px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-5xl flex-col items-center gap-6">
        <div className="flex flex-col items-center gap-1">
          <p className="font-semibold">Junkyard Index</p>
          <p className="text-sm text-muted-foreground">
            Search salvage yard inventory across the nation.
          </p>
        </div>
        <div className="flex gap-6 text-sm text-muted-foreground">
          <Link
            href="/search"
            className="transition-colors hover:text-foreground"
          >
            Search
          </Link>
          <Link
            href="/privacy"
            className="transition-colors hover:text-foreground"
          >
            Privacy Policy
          </Link>
          <Link
            href="/contact"
            className="transition-colors hover:text-foreground"
          >
            Contact
          </Link>
        </div>
        <p className="text-xs text-muted-foreground">
          &copy; {new Date().getFullYear()} Junkyard Index. All rights
          reserved.
        </p>
      </div>
    </footer>
  );
}
