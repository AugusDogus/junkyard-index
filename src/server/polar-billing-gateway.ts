import { env } from "~/env";
import { polarClient } from "~/lib/polar";
import { createPolarBillingGateway } from "~/server/polar-billing";

export const polarBillingGateway = createPolarBillingGateway(
  {
    listSubscriptions: (input) => polarClient.subscriptions.list(input),
    revokeSubscription: (input) => polarClient.subscriptions.revoke(input),
    getCustomerState: (input) => polarClient.customers.getStateExternal(input),
    listCheckouts: (input) => polarClient.checkouts.list(input),
    createCheckout: (input) => polarClient.checkouts.create(input),
  },
  {
    productId: env.POLAR_PRODUCT_ID,
    appUrl: env.NEXT_PUBLIC_APP_URL,
  },
);
