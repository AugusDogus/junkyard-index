import Link from "next/link";
import { TrackedPricingButton } from "~/components/marketing/TrackedPricingButton";
import { Button } from "~/components/ui/button";

/**
 * The pitch for saved-search alerts on an inventory page. `subject` finishes
 * "get an alert when ...", e.g. "a matching vehicle shows up at {yard}".
 */
export function AlertsCallout({
  subject,
  sourcePage,
}: {
  subject: string;
  sourcePage: "yard" | "model";
}) {
  return (
    <aside className="bg-muted/40 mt-10 rounded-lg border p-5">
      <h2 className="text-lg font-semibold text-balance">
        Waiting on a specific car?
      </h2>
      <p className="text-muted-foreground mt-2 text-sm text-pretty">
        Save a search and get an email or Discord alert when {subject}. New
        vehicles usually appear here within a day or two of the yard listing
        them.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <TrackedPricingButton
          href="/pricing"
          label="See alert plans"
          sourcePage={sourcePage}
          ctaLocation={`${sourcePage}_alerts_callout`}
          size="sm"
        />
        <Button asChild variant="outline" size="sm">
          <Link href="/search">Search every yard</Link>
        </Button>
      </div>
    </aside>
  );
}
