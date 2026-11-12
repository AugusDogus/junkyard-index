import Link from "next/link";
import { TrackedPricingButton } from "~/components/marketing/TrackedPricingButton";
import { Button } from "~/components/ui/button";

/**
 * The pitch for saved-search alerts on an inventory page. `subject` finishes
 * "get an alert when ...", e.g. "a matching vehicle shows up at {yard}".
 *
 * A plate: the head beside the pitch and its two actions. It carries no
 * outer margin; the page that places it sets the space around it.
 */
export function AlertsCallout({
  subject,
  sourcePage,
}: {
  subject: string;
  sourcePage: "yard" | "model";
}) {
  return (
    <aside className="border-ink bg-paper-3 grid gap-x-8 gap-y-6 border-2 p-6 sm:p-8 lg:grid-cols-12 lg:p-10">
      <h2 className="text-section leading-[1.02] font-extrabold lg:col-span-5">
        Waiting on a specific car?
      </h2>
      <div className="lg:col-span-7">
        <p className="text-ink-2 max-w-[60ch] text-base leading-relaxed text-pretty">
          Save a search and get an email or Discord alert when {subject}. New
          vehicles usually appear here within a day or two of the yard listing
          them.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <TrackedPricingButton
            href="/pricing"
            label="See alert plans"
            sourcePage={sourcePage}
            ctaLocation={`${sourcePage}_alerts_callout`}
            size="xl"
          />
          <Button
            asChild
            variant="outline"
            size="xl"
            className="active:bg-ink active:text-paper"
          >
            <Link href="/search">Search every yard</Link>
          </Button>
        </div>
      </div>
    </aside>
  );
}
