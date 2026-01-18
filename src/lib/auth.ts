import { checkout, polar, portal, usage, webhooks } from "@polar-sh/better-auth";
import { Polar } from "@polar-sh/sdk";
import { render } from "@react-email/components";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { eq } from "drizzle-orm";
import { Resend } from "resend";
import { PasswordReset } from "~/emails/PasswordReset";
import { env } from "~/env";
import { db } from "~/lib/db";
import * as schema from "~/schema";

const resend = new Resend(env.RESEND_API_KEY);

export const polarClient = new Polar({
  accessToken: env.POLAR_ACCESS_TOKEN,
});

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "sqlite",
    schema,
  }),
  baseURL: env.NEXT_PUBLIC_APP_URL,
  trustedOrigins: [env.NEXT_PUBLIC_APP_URL],
  emailAndPassword: {
    enabled: true,
    sendResetPassword: async ({ user, url }) => {
      const emailHtml = await render(PasswordReset({ resetUrl: url }));
      const emailText = await render(PasswordReset({ resetUrl: url }), { plainText: true });

      await resend.emails.send({
        from: `Junkyard Index <${env.RESEND_FROM_EMAIL}>`,
        to: user.email,
        subject: "Reset your password",
        html: emailHtml,
        text: emailText,
      });
    },
  },
  socialProviders: {
    discord: {
      clientId: env.NEXT_PUBLIC_DISCORD_CLIENT_ID,
      clientSecret: env.DISCORD_CLIENT_SECRET,
    },
  },
  databaseHooks: {
    account: {
      create: {
        after: async (account) => {
          // When a user signs in with Discord OAuth, capture their Discord user ID
          // The accountId from Discord is the user's Discord ID
          if (account.providerId === "discord" && account.accountId) {
            await db
              .update(schema.user)
              .set({ discordId: account.accountId })
              .where(eq(schema.user.id, account.userId));
          }
        },
      },
    },
  },
  secret: env.BETTER_AUTH_SECRET,
  plugins: [
    polar({
      client: polarClient,
      createCustomerOnSignUp: true,
      use: [
        checkout({
          products: [
            {
              productId: env.POLAR_PRODUCT_ID,
              slug: "Email-Notifications",
            },
          ],
          successUrl: `${env.NEXT_PUBLIC_APP_URL}/search?subscription=success`,
          authenticatedUsersOnly: true,
        }),
        portal(),
        usage(),
        webhooks({
          secret: env.POLAR_WEBHOOK_SECRET,
          onCustomerStateChanged: async (payload) => {
            // Triggered when anything regarding a customer changes (subscription status, etc.)
            // Check if customer has any active subscriptions
            const customerState = payload.data;
            const hasActiveSubscription = customerState.activeSubscriptions.length > 0;

            // If no active subscriptions, disable email alerts for this customer
            if (!hasActiveSubscription && customerState.externalId) {
              await db
                .update(schema.savedSearch)
                .set({ emailAlertsEnabled: false })
                .where(eq(schema.savedSearch.userId, customerState.externalId));
            }
          },
        }),
      ],
    }),
  ],
});
