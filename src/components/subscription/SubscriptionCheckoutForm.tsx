"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { Checkbox } from "~/components/ui/checkbox";
import { Label } from "~/components/ui/label";
import { useSubscriptionDestination } from "~/hooks/use-subscription-destination";
import { TERMS_METADATA } from "~/lib/legal";
import {
  PLANS,
  formatMonthlyEquivalent,
  planPrice,
  type PaidPlanTier,
} from "~/lib/plans";
import { parseSubscriptionSelection } from "~/lib/subscription-selection";
import { api } from "~/trpc/react";

const PLAN_SUMMARIES: Record<PaidPlanTier, string> = {
  lite: "Unlimited search, advanced filters, and saved searches.",
  full: "Unlimited search, advanced filters, saved searches, and alerts.",
};

export function SubscriptionCheckoutForm() {
  const searchParams = useSearchParams();
  const { tier, interval } = parseSubscriptionSelection({
    tier: searchParams.get("tier"),
    interval: searchParams.get("interval"),
  });
  const [hasAcceptedTerms, setHasAcceptedTerms] = useState(false);
  const [isOpeningCheckout, setIsOpeningCheckout] = useState(false);
  const createCheckout = api.subscription.createCheckout.useMutation();
  const {
    hasActiveSubscription,
    hasManageableSubscription,
    isError: isSubscriptionError,
    isLoading: isSubscriptionLoading,
    open: openSubscriptionDestination,
    retry: retrySubscription,
  } = useSubscriptionDestination({
    source: "subscribe_page",
  });

  const handleCheckout = async () => {
    if (!hasAcceptedTerms) {
      return;
    }

    setIsOpeningCheckout(true);
    try {
      const checkout = await createCheckout.mutateAsync({
        termsVersion: TERMS_METADATA.version,
        tier,
        interval,
      });
      window.location.assign(checkout.url);
    } catch (error) {
      console.error("Failed to open checkout:", error);
      toast.error(
        error instanceof Error
          ? error.message
          : "Checkout could not be opened. Your account and saved searches are unchanged. Please try again.",
      );
      setIsOpeningCheckout(false);
    }
  };

  if (isSubscriptionError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Subscription status unavailable</CardTitle>
          <CardDescription>
            We could not safely verify whether this account already has a
            subscription. No checkout was started.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button className="w-full" onClick={() => void retrySubscription()}>
            Try Again
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (hasManageableSubscription) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>
            {hasActiveSubscription
              ? "Subscription already active"
              : "Subscription needs attention"}
          </CardTitle>
          <CardDescription>
            Manage your existing subscription instead of starting another
            checkout.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            className="w-full"
            onClick={() => void openSubscriptionDestination()}
          >
            Manage Subscription
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{PLANS[tier].name} Plan</CardTitle>
        <CardDescription>{PLAN_SUMMARIES[tier]}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div>
          <p className="text-3xl font-bold">
            ${planPrice(tier, interval)}
            <span className="text-muted-foreground text-base font-normal">
              {interval === "annual" ? "/year" : "/month"}
            </span>
          </p>
          <p className="text-muted-foreground mt-2 text-sm">
            Your subscription renews automatically{" "}
            {interval === "annual" ? "each year" : "each month"} until you
            cancel.
            {interval === "annual"
              ? ` That is ${formatMonthlyEquivalent(tier)} per month.`
              : ""}{" "}
            You can cancel anytime from Manage Subscription. Polar handles
            payment, taxes, billing, and payment-related refunds.
          </p>
        </div>

        <div className="flex items-start gap-2 rounded-md border p-4">
          <Checkbox
            id="subscription-legal-acceptance"
            checked={hasAcceptedTerms}
            onCheckedChange={(checked) => setHasAcceptedTerms(checked === true)}
            disabled={isOpeningCheckout || isSubscriptionLoading}
            required
          />
          <Label
            htmlFor="subscription-legal-acceptance"
            className="text-muted-foreground block leading-5 font-normal"
          >
            I agree to the{" "}
            <Link href="/terms" className="text-primary hover:underline">
              Terms of Service
            </Link>{" "}
            and acknowledge the{" "}
            <Link href="/privacy" className="text-primary hover:underline">
              Privacy Policy
            </Link>
            , including the recurring auto-renewal and cancellation terms above.
          </Label>
        </div>

        <Button
          className="w-full"
          disabled={
            !hasAcceptedTerms || isOpeningCheckout || isSubscriptionLoading
          }
          onClick={() => void handleCheckout()}
        >
          {isOpeningCheckout
            ? "Opening secure checkout..."
            : `Continue to Polar checkout`}
        </Button>

        <p className="text-muted-foreground text-center text-xs">
          Your purchase is also subject to the{" "}
          <a
            href="https://polar.sh/legal/checkout-buyer-terms"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline"
          >
            Polar Buyer Terms and Conditions
          </a>
          .
        </p>
      </CardContent>
    </Card>
  );
}
