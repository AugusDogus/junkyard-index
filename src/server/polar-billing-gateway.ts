import { env } from "~/env";
import { polarClient } from "~/lib/polar";
import { createPolarBillingGateway } from "~/server/polar-billing";

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

const productIds = [
  env.POLAR_LITE_PRODUCT_ID,
  env.POLAR_LITE_ANNUAL_PRODUCT_ID,
  env.POLAR_FULL_PRODUCT_ID,
  env.POLAR_FULL_ANNUAL_PRODUCT_ID,
  ...(env.POLAR_PRODUCT_ID ? [env.POLAR_PRODUCT_ID] : []),
];

export function createPolarBillingGatewayForCheckout(productId: string) {
  return createPolarBillingGateway(operations, {
    productIds,
    checkoutProductId: productId,
    appUrl: env.NEXT_PUBLIC_APP_URL,
  });
}

export const polarBillingGateway = createPolarBillingGatewayForCheckout(
  env.POLAR_FULL_PRODUCT_ID,
);
