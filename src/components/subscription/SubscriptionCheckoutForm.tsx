"use client";

import Link from "next/link";
import posthog from "posthog-js";
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
import { AnalyticsEvents } from "~/lib/analytics-events";
import { authClient } from "~/lib/auth-client";
import { MONETIZATION_CONFIG } from "~/lib/constants";
import { api } from "~/trpc/react";

export function SubscriptionCheckoutForm() {
  const [hasAcceptedTerms, setHasAcceptedTerms] = useState(false);
  const acceptTerms = api.user.acceptCurrentTerms.useMutation();

  const handleCheckout = async () => {
    if (!hasAcceptedTerms) {
      return;
    }

    try {
      await acceptTerms.mutateAsync();
      posthog.capture(AnalyticsEvents.CHECKOUT_INITIATED, {
        source: "subscription_confirmation",
      });
      await authClient.checkout({
        slug: MONETIZATION_CONFIG.CHECKOUT_SLUG,
      });
    } catch (error) {
      console.error("Failed to open checkout:", error);
      toast.error(
        "Checkout could not be opened. Your account and saved searches are unchanged. Please try again.",
      );
    }
  };

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
            disabled={acceptTerms.isPending}
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
          disabled={!hasAcceptedTerms || acceptTerms.isPending}
          onClick={() => void handleCheckout()}
        >
          {acceptTerms.isPending
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
