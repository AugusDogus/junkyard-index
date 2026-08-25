import { env } from "~/env";
import { polarClient } from "~/lib/polar";
import { createPolarBillingGateway } from "~/server/polar-billing";
import { billingProductCatalog } from "~/server/billing/configured-product-catalog";

const operations = {
  listSubscriptions: (
    input: Parameters<typeof polarClient.subscriptions.list>[0],
  ) => polarClient.subscriptions.list(input),
  revokeSubscription: (
    input: Parameters<typeof polarClient.subscriptions.revoke>[0],
  ) => polarClient.subscriptions.revoke(input),
  getCustomerState: (
    input: Parameters<typeof polarClient.customers.getStateExternal>[0],
  ) => polarClient.customers.getStateExternal(input),
  listCheckouts: (input: Parameters<typeof polarClient.checkouts.list>[0]) =>
    polarClient.checkouts.list(input),
  createCheckout: (input: Parameters<typeof polarClient.checkouts.create>[0]) =>
    polarClient.checkouts.create(input),
};

export const polarBillingGateway = createPolarBillingGateway(operations, {
  catalog: billingProductCatalog,
  appUrl: env.NEXT_PUBLIC_APP_URL,
});
