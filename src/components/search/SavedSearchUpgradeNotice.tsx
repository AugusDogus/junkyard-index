import { Lock } from "lucide-react";
import Link from "next/link";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";

interface SavedSearchUpgradeNoticeProps {
  className?: string;
}

export function SavedSearchUpgradeNotice({
  className,
}: SavedSearchUpgradeNoticeProps) {
  return (
    <Alert className={className}>
      <Lock aria-hidden="true" />
      <AlertTitle>Your searches are still here</AlertTitle>
      <AlertDescription>
        <p>
          Lite restores every saved query and filter, and lets you save new
          searches.
        </p>
        <Button asChild size="sm">
          <Link href="/pricing">View Lite</Link>
        </Button>
      </AlertDescription>
    </Alert>
  );
}
