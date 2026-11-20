import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";

export function InventoryFilterFeedback({
  isPending,
  isError,
  retry,
  canTypeValues = true,
}: {
  isPending: boolean;
  isError: boolean;
  retry: () => void;
  /** Whether the list accepts typed values that are not in the options. */
  canTypeValues?: boolean;
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
        Your selections are preserved.
        {canTypeValues ? " You can still type values to add them." : null}
        <Button type="button" variant="outline" size="sm" onClick={retry}>
          Retry loading filters
        </Button>
      </AlertDescription>
    </Alert>
  );
}
