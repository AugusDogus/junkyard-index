import { Lock } from "lucide-react";
import Link from "next/link";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";

interface SavedSearchUpgradeNoticeProps {
  compact?: boolean;
  className?: string;
}

export function SavedSearchUpgradeNotice({
  compact = false,
  className,
}: SavedSearchUpgradeNoticeProps) {
  return (
    <div
      className={cn(
        "bg-muted/40 flex gap-3 rounded-lg border p-4 text-left",
        compact ? "flex-col" : "items-center",
        className,
      )}
    >
      <Lock className="text-muted-foreground size-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">Your saved searches are preserved</p>
        <p className="text-muted-foreground mt-1 text-xs text-pretty">
          Upgrade to Lite to reopen them with their filters and save new
          searches.
        </p>
      </div>
      <Button asChild size="sm" className={compact ? "w-full" : "shrink-0"}>
        <Link href="/pricing">Upgrade to Lite</Link>
      </Button>
    </div>
  );
}
