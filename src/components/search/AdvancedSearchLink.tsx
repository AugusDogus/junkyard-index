import Link from "next/link";
import { cn } from "~/lib/utils";

export function AdvancedSearchLink({
  enabled,
  href,
  className,
}: {
  enabled: boolean;
  href: string;
  className?: string;
}) {
  const linkClassName = cn(
    "inline-flex min-h-11 items-center text-sm font-medium underline-offset-4 md:min-h-6",
    className,
  );

  if (!enabled) {
    return (
      <span
        aria-disabled="true"
        className={cn(
          linkClassName,
          "text-muted-foreground cursor-not-allowed",
        )}
      >
        Advanced search
      </span>
    );
  }

  return (
    <Link
      href={href}
      className={cn(
        linkClassName,
        "text-muted-foreground hover:text-foreground focus-visible:text-foreground hover:underline",
      )}
    >
      Advanced search
    </Link>
  );
}
