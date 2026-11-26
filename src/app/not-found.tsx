import type { Metadata } from "next";
import Link from "next/link";
import { PublicPageShell } from "~/components/junkyards/PublicPageShell";
import { Button } from "~/components/ui/button";
import { notFoundMetadata } from "./root-metadata";

export const metadata: Metadata = notFoundMetadata;

export default function NotFound() {
  return (
    <PublicPageShell>
      <div className="mx-auto max-w-xl py-12 text-center">
        <p className="text-muted-foreground text-sm">404</p>
        <h1 className="mt-2 text-3xl font-medium tracking-tight text-balance">
          We couldn&apos;t find that page
        </h1>
        <p className="text-muted-foreground mt-3 text-pretty">
          The link may be old, or a yard may have stopped listing its inventory.
          Every yard we track is listed by state, and search covers all of them
          at once.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Button asChild>
            <Link href="/junkyards">Browse yards by state</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/search">Search inventory</Link>
          </Button>
        </div>
      </div>
    </PublicPageShell>
  );
}
