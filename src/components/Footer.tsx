import Link from "next/link";

export function Footer() {
  return (
    <footer className="border-t px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-5xl flex-col items-center gap-6">
        <div className="flex flex-col items-center gap-1">
          <p className="font-semibold">Junkyard Index</p>
          <p className="text-muted-foreground text-sm">
            Search salvage yard inventory across the nation.
          </p>
        </div>
        <div className="text-muted-foreground flex gap-6 text-sm">
          <Link
            href="/search"
            className="hover:text-foreground transition-colors"
          >
            Search
          </Link>
          <Link
            href="/privacy"
            className="hover:text-foreground transition-colors"
          >
            Privacy Policy
          </Link>
          <Link
            href="/contact"
            className="hover:text-foreground transition-colors"
          >
            Contact
          </Link>
        </div>
        <p className="text-muted-foreground text-xs">
          &copy; {new Date().getFullYear()} Junkyard Index. All rights reserved.
        </p>
      </div>
    </footer>
  );
}
