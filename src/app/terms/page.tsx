import { type Metadata } from "next";
import Link from "next/link";
import { Footer } from "~/components/Footer";
import { Header } from "~/components/Header";
import { TERMS_METADATA } from "~/lib/legal";

export const metadata: Metadata = {
  title: "Terms of Service",
  description:
    "Terms governing your use of Junkyard Index search, saved searches, and alerts.",
  alternates: {
    canonical: "/terms",
  },
};

export default function TermsPage() {
  return (
    <div className="bg-background min-h-screen">
      <Header />

      <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8">
        <h1 className="mb-8 text-4xl font-bold tracking-tight">
          Terms of Service
        </h1>

        <p className="text-muted-foreground mb-8">
          Effective: {TERMS_METADATA.effectiveDate}
        </p>

        <div className="prose prose-neutral dark:prose-invert max-w-none space-y-8">
          <section>
            <h2 className="mb-4 text-2xl font-semibold">
              Agreement to These Terms
            </h2>
            <p className="text-muted-foreground">
              These Terms of Service (&ldquo;Terms&rdquo;) govern your access to
              and use of the Junkyard Index website, search tools, saved
              searches, alerts, and related services (collectively, the
              &ldquo;Service&rdquo;). The Service is operated by whisp labs LLC
              under the Junkyard Index name (&ldquo;Junkyard Index,&rdquo;
              &ldquo;we,&rdquo; &ldquo;our,&rdquo; or &ldquo;us&rdquo;). By
              creating an account, purchasing a subscription, or otherwise using
              the Service, you agree to these Terms and our{" "}
              <Link href="/privacy" className="text-primary hover:underline">
                Privacy Policy
              </Link>
              . If you do not agree, do not use the Service.
            </p>
            <p className="text-muted-foreground mt-4">
              You must be at least 18 years old to create an account or buy a
              subscription. If you use the Service for an organization, you
              represent that you have authority to accept these Terms for that
              organization.
            </p>
          </section>

          <section>
            <h2 className="mb-4 text-2xl font-semibold">
              What the Service Provides
            </h2>
            <p className="text-muted-foreground">
              Junkyard Index aggregates vehicle inventory information from
              salvage yards, yard networks, and other third-party sources. The
              Service helps you search that information and, if enabled, receive
              notifications about potential matches. Junkyard Index does not own
              the listed vehicles, sell vehicle parts, reserve inventory, or
              control participating yards. Unless expressly stated, we are not
              affiliated with or endorsed by any listed yard or network.
            </p>
          </section>

          <section>
            <h2 className="mb-4 text-2xl font-semibold">
              Inventory and Search Information
            </h2>
            <p className="text-muted-foreground">
              Inventory information comes from third parties and may be delayed,
              stale, incomplete, duplicated, inaccurate, or unavailable. Search
              results may not reflect a yard&rsquo;s current inventory, vehicle
              condition, part availability, pricing, location, or policies. A
              listing is not a representation that a vehicle or part is still
              available.
            </p>
            <p className="text-muted-foreground mt-4">
              You are responsible for confirming inventory, vehicle details,
              prices, hours, and purchase requirements directly with the yard
              before traveling, purchasing, or relying on the information.
            </p>
          </section>

          <section>
            <h2 className="mb-4 text-2xl font-semibold">
              Service Availability
            </h2>
            <p className="text-muted-foreground">
              The Service is provided on an &ldquo;as is&rdquo; and &ldquo;as
              available&rdquo; basis. We do not promise that the Service will be
              uninterrupted, continuously available, timely, secure, or free
              from errors. Ingestion pipelines, search indexes, websites,
              databases, notification systems, and third-party providers may
              experience delays, partial failures, or outages. We may perform
              maintenance or modify, suspend, or discontinue any part of the
              Service at any time. No service-level agreement or uptime
              commitment applies unless we agree to one in a separate written
              agreement.
            </p>
            <p className="text-muted-foreground mt-4">
              We are not responsible for delay or failure caused by events
              beyond our reasonable control, including internet or utility
              failures, provider outages, natural disasters, labor disruptions,
              government actions, attacks, or emergencies.
            </p>
          </section>

          <section>
            <h2 className="mb-4 text-2xl font-semibold">Alerts</h2>
            <p className="text-muted-foreground">
              Email, Discord, and other alerts are convenience features provided
              on a best-effort basis. Alerts may be delayed, duplicated,
              incomplete, or not delivered. Alert delivery depends on successful
              inventory collection, search indexing, matching, and third-party
              services outside our control. We do not guarantee that you will
              receive an alert for every matching vehicle or before a vehicle or
              part becomes unavailable. Do not rely on alerts as your only way
              to monitor time-sensitive inventory.
            </p>
          </section>

          <section>
            <h2 className="mb-4 text-2xl font-semibold">
              Accounts and Acceptable Use
            </h2>
            <p className="text-muted-foreground">
              You must provide accurate account information and keep your login
              credentials secure. You are responsible for activity under your
              account. You may not share an account in a way that defeats plan
              limits or allow another person to use your credentials.
            </p>
            <p className="text-muted-foreground mt-4">You may not:</p>
            <ul className="text-muted-foreground mt-2 list-disc space-y-1 pl-6">
              <li>break the law or violate another person&rsquo;s rights;</li>
              <li>
                scrape, crawl, or automatically extract data without our written
                permission;
              </li>
              <li>
                reverse engineer the Service or use it to build a competing
                inventory database or service;
              </li>
              <li>
                bypass access controls, usage limits, rate limits, or security
                measures;
              </li>
              <li>
                introduce malware, interfere with operation, or attempt
                unauthorized access; or
              </li>
              <li>impersonate another person or misrepresent affiliation.</li>
            </ul>
            <p className="text-muted-foreground mt-4">
              We may restrict or terminate access when reasonably necessary to
              protect the Service, our users, or third parties.
            </p>
          </section>

          <section>
            <h2 className="mb-4 text-2xl font-semibold">
              Your Data and Service Data
            </h2>
            <p className="text-muted-foreground">
              You retain your rights in information you provide, such as saved
              searches, preferences, and messages sent through the contact form.
              You give us a limited, nonexclusive license to host, process,
              transmit, and display that information only as needed to operate,
              secure, support, and improve the Service.
            </p>
            <p className="text-muted-foreground mt-4">
              We may create and use aggregated or deidentified statistics that
              do not reasonably identify you. Inventory and other third-party
              data remain subject to the rights of their respective owners. The
              Service does not currently offer a general data export feature.
            </p>
          </section>

          <section>
            <h2 className="mb-4 text-2xl font-semibold">Free Service</h2>
            <p className="text-muted-foreground">
              Free access may include limits on visible results, saved searches,
              alerts, or other features. Current limits are shown in the
              Service. We may change or discontinue free features, but a free
              account will not automatically become a paid subscription without
              your affirmative purchase.
            </p>
          </section>

          <section>
            <h2 className="mb-4 text-2xl font-semibold">
              Subscriptions, Billing, and Cancellation
            </h2>
            <p className="text-muted-foreground">
              Polar Software, Inc. (&ldquo;Polar&rdquo;) acts as the merchant of
              record and authorized reseller for paid subscriptions. Prices,
              renewal frequency, and cancellation terms are presented before and
              at checkout. Paid subscriptions renew automatically at the
              displayed interval until canceled. Checkout, payment processing,
              taxes, subscription billing, failed payments, and payment-related
              refunds are governed by the{" "}
              <a
                href="https://polar.sh/legal/checkout-buyer-terms"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                Polar Buyer Terms and Conditions
              </a>
              . Your right to access and use Junkyard Index remains governed by
              these Terms. You may cancel through the subscription management
              page. Cancellation stops future renewal but normally does not
              refund the current billing period. Deleting your Junkyard Index
              account ends your access immediately and first attempts to revoke
              every subscription that could still renew or recover payment.
              Account deletion will stop if billing status or revocation cannot
              be confirmed, or while a checkout is unfinished. Deleting an
              account does not itself create a refund. We may change plan
              features with reasonable notice, subject to applicable law and
              Polar&rsquo;s terms.
            </p>
          </section>

          <section>
            <h2 className="mb-4 text-2xl font-semibold">
              Third-Party Services
            </h2>
            <p className="text-muted-foreground">
              The Service relies on third-party inventory sources, hosting,
              databases, search, authentication, payment, email, Discord, and
              other providers. Their services and content are governed by their
              own terms and may change or become unavailable. We are not
              responsible for third-party services, websites, content, acts, or
              omissions.
            </p>
          </section>

          <section>
            <h2 className="mb-4 text-2xl font-semibold">
              Intellectual Property
            </h2>
            <p className="text-muted-foreground">
              The Service, including its software, design, branding, and
              original content, is owned by whisp labs LLC or its licensors and
              is protected by applicable intellectual-property laws. Third-party
              names, trademarks, inventory data, and content remain the property
              of their respective owners. These Terms give you a limited,
              revocable, nonexclusive right to use the Service for its intended
              purpose.
            </p>
          </section>

          <section>
            <h2 className="mb-4 text-2xl font-semibold">
              Disclaimer of Warranties
            </h2>
            <p className="text-muted-foreground">
              To the fullest extent permitted by law, whisp labs LLC disclaims
              all warranties, express or implied, including warranties of
              merchantability, fitness for a particular purpose, title,
              noninfringement, accuracy, availability, and reliability. We do
              not warrant that search results or alerts will meet your needs or
              that defects or interruptions will be corrected within any
              particular time.
            </p>
          </section>

          <section>
            <h2 className="mb-4 text-2xl font-semibold">
              Limitation of Liability
            </h2>
            <p className="text-muted-foreground">
              To the fullest extent permitted by law, whisp labs LLC and its
              owners, personnel, and service providers will not be liable for
              indirect, incidental, special, consequential, exemplary, or
              punitive damages, or for lost profits, lost data, missed
              inventory, travel costs, substitute purchases, or lost
              opportunities arising from or related to the Service. This
              includes damages caused by inaccurate or stale data, missed or
              delayed alerts, ingestion or search-index failures, outages, or
              third-party services.
            </p>
            <p className="text-muted-foreground mt-4">
              To the fullest extent permitted by law, our total liability for
              all claims arising from or related to the Service will not exceed
              the greater of $100 or the amount you paid for the Service through
              Polar during the 12 months before the event giving rise to the
              claim. Some jurisdictions do not allow certain exclusions or
              limitations, so portions of this section may not apply to you.
            </p>
          </section>

          <section>
            <h2 className="mb-4 text-2xl font-semibold">Indemnification</h2>
            <p className="text-muted-foreground">
              To the extent permitted by law, you will defend and indemnify
              whisp labs LLC against third-party claims, losses, and reasonable
              costs arising from your unlawful use of the Service, your material
              violation of these Terms, your infringement of another
              person&rsquo;s rights, or your fraud or willful misconduct. This
              obligation does not apply to the extent a claim results from our
              own wrongdoing.
            </p>
          </section>

          <section>
            <h2 className="mb-4 text-2xl font-semibold">Termination</h2>
            <p className="text-muted-foreground">
              You may stop using the Service at any time and may delete your
              account from Settings. We may suspend or terminate access for a
              material violation of these Terms, fraud, abuse, security risk,
              legal requirement, or discontinuation of the Service. When an
              account is deleted, access ends and active application data such
              as saved searches and alert settings is deleted, subject to the
              retention described in our Privacy Policy. Subscription
              cancellation and refunds remain subject to the billing section
              above.
            </p>
            <p className="text-muted-foreground mt-4">
              Provisions that by their nature should continue after termination
              will survive, including intellectual-property, disclaimer,
              liability, indemnification, and general provisions.
            </p>
          </section>

          <section>
            <h2 className="mb-4 text-2xl font-semibold">
              Changes to the Service or Terms
            </h2>
            <p className="text-muted-foreground">
              We may update these Terms as the Service changes. We will post the
              updated Terms and revise the effective date. We will give at least
              30 days&rsquo; advance notice by email or a prominent notice in
              the Service before a materially adverse change takes effect. We
              may make changes sooner when reasonably necessary for security,
              legal, or regulatory reasons. Your continued use after updated
              Terms take effect means you accept them. If you do not accept an
              update, you may stop using the Service and cancel any subscription
              before the change takes effect.
            </p>
          </section>

          <section>
            <h2 className="mb-4 text-2xl font-semibold">General Terms</h2>
            <p className="text-muted-foreground">
              Applicable law may provide rights that these Terms cannot limit or
              waive. If any provision is unenforceable, the remaining provisions
              remain in effect. Our failure to enforce a provision is not a
              waiver. You may not assign these Terms without our written
              consent. We may assign them in connection with a merger,
              acquisition, financing, reorganization, or sale of the Service or
              related assets. Notices to you may be sent to your account email
              or displayed prominently in the Service. Notices to us must be
              submitted through the contact page. These Terms and the Privacy
              Policy are the entire agreement between you and whisp labs LLC
              concerning the Service unless we enter into a separate written
              agreement.
            </p>
          </section>

          <section>
            <h2 className="mb-4 text-2xl font-semibold">Contact Us</h2>
            <p className="text-muted-foreground">
              Questions about these Terms may be submitted through our{" "}
              <Link href="/contact" className="text-primary hover:underline">
                contact page
              </Link>
              .
            </p>
          </section>
        </div>
      </main>

      <Footer />
    </div>
  );
}
