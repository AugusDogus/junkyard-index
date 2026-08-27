"use client";

import { ListFilterPlus } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Button } from "~/components/ui/button";

export function AdvancedSearchLink({
  iconOnly = false,
}: {
  iconOnly?: boolean;
}) {
  const searchParams = useSearchParams();
  const queryString = searchParams.toString();
  const href = queryString
    ? `/search/advanced?${queryString}`
    : "/search/advanced";

  return (
    <Button
      asChild
      type="button"
      variant="outline"
      size={iconOnly ? "icon" : "default"}
    >
      <Link
        href={href}
        aria-label={iconOnly ? "Open advanced search" : undefined}
      >
        <ListFilterPlus data-icon="inline-start" />
        {!iconOnly && "Advanced"}
      </Link>
    </Button>
  );
}
