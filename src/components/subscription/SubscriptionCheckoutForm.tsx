"use client";

import Link from "next/link";
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
import { MONETIZATION_CONFIG } from "~/lib/constants";
import { TERMS_METADATA } from "~/lib/legal";
import { api } from "~/trpc/react";

export function SubscriptionCheckoutForm() {
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
            Manage your existing Alerts Plan instead of starting another
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
        <CardTitle>Alerts Plan</CardTitle>
        <CardDescription>
          Email and Discord alerts for your saved searches.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div>
          <p className="text-3xl font-bold">
            ${MONETIZATION_CONFIG.ALERTS_PLAN_PRICE_MONTHLY}
            <span className="text-muted-foreground text-base font-normal">
              /month
            </span>
          </p>
          <p className="text-muted-foreground mt-2 text-sm">
            Your subscription renews automatically each month until you cancel.
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
            className="text-muted-foreground leading-5 font-normal"
          >
            I agree to the{" "}
            <Link href="/terms" className="text-primary hover:underline">
              Terms of Service
            </Link>{" "}
            and acknowledge the{" "}
            <Link href="/privacy" className="text-primary hover:underline">
              Privacy Policy
            </Link>
            , including the monthly auto-renewal and cancellation terms above.
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
