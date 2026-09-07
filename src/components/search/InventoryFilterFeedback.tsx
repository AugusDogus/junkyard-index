import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";

export function InventoryFilterFeedback({
  isPending,
  isError,
  retry,
}: {
  isPending: boolean;
  isError: boolean;
  retry: () => void;
}) {
  if (isPending)
    return (
      <p className="text-muted-foreground text-sm" role="status">
        Loading filter suggestions…
      </p>
    );
  if (!isError) return null;
  return (
    <Alert variant="destructive">
      <AlertTitle>Filter suggestions could not load</AlertTitle>
      <AlertDescription>
        Your selections are preserved. You can still type values to add them.
        <Button type="button" variant="outline" size="sm" onClick={retry}>
          Retry loading filters
        </Button>
      </AlertDescription>
    </Alert>
  );
}
