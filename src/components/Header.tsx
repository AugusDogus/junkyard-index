import { headers } from "next/headers";
import Link from "next/link";
import { ThemeToggle } from "~/components/theme/theme-toggle";
import { auth } from "~/lib/auth";
import { HeaderAuthButtons } from "./HeaderAuthButtons";

export async function Header() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  return (
    <header className="bg-card border-b shadow-sm">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center">
          <div className="flex items-center space-x-4">
            <Link href="/search" className="text-foreground text-xl font-bold">
              Junkyard Index
            </Link>
          </div>
          <div className="ml-auto flex items-center gap-4">
            <HeaderAuthButtons user={session?.user ?? null} />
            <ThemeToggle />
          </div>
        </div>
      </div>
    </header>
  );
}
