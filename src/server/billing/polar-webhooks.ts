import type { WebhookCustomerStateChangedPayload } from "@polar-sh/sdk/models/components/webhookcustomerstatechangedpayload";
import type { WebhookSubscriptionCreatedPayload } from "@polar-sh/sdk/models/components/webhooksubscriptioncreatedpayload";
import { env } from "~/env";
import { db } from "~/lib/db";
import { hasPlanFeature } from "~/lib/plans";
import posthog from "~/lib/posthog-server";
import { setUserAlertChannel } from "~/server/alerts/alert-config-repository";
import { recordCheckoutCompletion } from "~/server/billing-operation";
import { resolveCustomerPlanTier } from "./user-plan";

export async function handleSubscriptionCreated(
  payload: WebhookSubscriptionCreatedPayload,
): Promise<void> {
  const externalId = payload.data.customer?.externalId;
  const resolution = resolveCustomerPlanTier({
    activeSubscriptions: [payload.data],
  });
  if (resolution.kind === "unrecognized") {
    console.error(
      "Polar subscription-created webhook referenced an unconfigured product. Billing state was preserved for manual recovery.",
    );
    return;
  }
  const planTier = resolution.tier;
  if (externalId && planTier !== "free") {
    await recordCheckoutCompletion({
      database: db,
      userId: externalId,
    });
    posthog.capture({
      distinctId: externalId,
      event: "subscription_created",
      properties: { plan_tier: planTier },
    });
  }

  if (
    planTier !== "free" &&
    env.GOOGLE_ADS_CONVERSION_ID &&
    env.GOOGLE_ADS_CONVERSION_LABEL
  ) {
    try {
      const conversionUrl = new URL(
        `https://www.googleadservices.com/pagead/conversion/${env.GOOGLE_ADS_CONVERSION_ID}/`,
      );
      conversionUrl.searchParams.set("label", env.GOOGLE_ADS_CONVERSION_LABEL);
      conversionUrl.searchParams.set("value", "1.0");
      conversionUrl.searchParams.set("currency", "USD");

      await fetch(conversionUrl.toString(), { method: "GET" });
    } catch (error) {
      console.error("Failed to send Google Ads conversion:", error);
    }
  }
}

export async function handleCustomerStateChanged(
  payload: WebhookCustomerStateChangedPayload,
): Promise<void> {
  const customerState = payload.data;
  const resolution = resolveCustomerPlanTier(customerState);
  if (resolution.kind === "unrecognized") {
    console.error(
      `Polar customer ${customerState.externalId ?? "without an external ID"} has active subscriptions matching no configured product. Existing alert settings were preserved.`,
    );
    return;
  }
  const planTier = resolution.tier;

  if (customerState.externalId) {
    posthog.capture({
      distinctId: customerState.externalId,
      event: "subscription_state_changed",
      properties: {
        has_active_subscription: planTier !== "free",
        plan_tier: planTier,
        active_subscription_count: customerState.activeSubscriptions.length,
      },
    });
  }

  if (!hasPlanFeature(planTier, "alerts") && customerState.externalId) {
    await Promise.all([
      setUserAlertChannel({
        database: db,
        userId: customerState.externalId,
        channel: "email",
        enabled: false,
      }),
      setUserAlertChannel({
        database: db,
        userId: customerState.externalId,
        channel: "discord",
        enabled: false,
      }),
    ]);
  }
}
