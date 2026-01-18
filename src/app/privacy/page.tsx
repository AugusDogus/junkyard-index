import { type Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "Privacy Policy for Junkyard Index - Learn how we collect, use, and protect your data.",
};

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b">
        <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 lg:px-8">
          <Link href="/" className="text-2xl font-bold">
            Junkyard Index
          </Link>
        </div>
      </header>

      {/* Content */}
      <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8">
        <h1 className="mb-8 text-4xl font-bold tracking-tight">Privacy Policy</h1>
        
        <p className="mb-8 text-muted-foreground">
          Last updated: {new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
        </p>

        <div className="prose prose-neutral dark:prose-invert max-w-none space-y-8">
          <section>
            <h2 className="mb-4 text-2xl font-semibold">Overview</h2>
            <p className="text-muted-foreground">
              Junkyard Index (&ldquo;we&rdquo;, &ldquo;our&rdquo;, or &ldquo;us&rdquo;) is committed to protecting your privacy. 
              This Privacy Policy explains how we collect, use, disclose, and safeguard your information when 
              you use our website and services.
            </p>
          </section>

          <section>
            <h2 className="mb-4 text-2xl font-semibold">Information We Collect</h2>
            
            <h3 className="mb-2 mt-4 text-lg font-medium">Account Information</h3>
            <p className="text-muted-foreground">
              When you create an account, we collect:
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-6 text-muted-foreground">
              <li>Email address</li>
              <li>Name (if provided)</li>
              <li>Profile picture (if you sign in with a social provider)</li>
            </ul>

            <h3 className="mb-2 mt-4 text-lg font-medium">Usage Information</h3>
            <p className="text-muted-foreground">
              We automatically collect certain information when you use our service:
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-6 text-muted-foreground">
              <li>Search queries and saved searches</li>
              <li>IP address and approximate location (for distance calculations)</li>
              <li>Device and browser information</li>
              <li>Pages visited and actions taken</li>
            </ul>
          </section>

          <section>
            <h2 className="mb-4 text-2xl font-semibold">How We Use Your Information</h2>
            <p className="text-muted-foreground">We use the information we collect to:</p>
            <ul className="mt-2 list-disc space-y-1 pl-6 text-muted-foreground">
              <li>Provide and maintain our service</li>
              <li>Send email alerts when new vehicles match your saved searches</li>
              <li>Calculate distances to salvage yards based on your location</li>
              <li>Improve our service and user experience</li>
              <li>Respond to your inquiries and support requests</li>
              <li>Detect and prevent fraud or abuse</li>
            </ul>
          </section>

          <section>
            <h2 className="mb-4 text-2xl font-semibold">Third-Party Services</h2>
            <p className="text-muted-foreground">
              We use the following third-party services to operate Junkyard Index:
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-6 text-muted-foreground">
              <li><strong>Polar</strong> - Payment processing and subscription management</li>
              <li><strong>Vercel</strong> - Website hosting and analytics</li>
              <li><strong>Turso</strong> - Database hosting</li>
              <li><strong>Resend</strong> - Email delivery for alerts and notifications</li>
              <li><strong>Sentry</strong> - Error tracking and performance monitoring</li>
            </ul>
            <p className="mt-4 text-muted-foreground">
              Each of these services has their own privacy policy governing their use of your data.
            </p>
          </section>

          <section>
            <h2 className="mb-4 text-2xl font-semibold">Data Retention</h2>
            <p className="text-muted-foreground">
              We retain your account information and saved searches for as long as your account is active. 
              If you delete your account, we will delete your personal information within 30 days, except 
              where we are required to retain it for legal purposes.
            </p>
          </section>

          <section>
            <h2 className="mb-4 text-2xl font-semibold">Your Rights</h2>
            <p className="text-muted-foreground">You have the right to:</p>
            <ul className="mt-2 list-disc space-y-1 pl-6 text-muted-foreground">
              <li>Access the personal information we hold about you</li>
              <li>Request correction of inaccurate information</li>
              <li>Delete your account and associated data</li>
              <li>Unsubscribe from email alerts at any time</li>
              <li>Export your saved searches</li>
            </ul>
            <p className="mt-4 text-muted-foreground">
              You can delete your account from the user menu in the application. To unsubscribe from 
              email alerts, click the unsubscribe link in any alert email or disable alerts for 
              individual saved searches.
            </p>
          </section>

          <section>
            <h2 className="mb-4 text-2xl font-semibold">Cookies</h2>
            <p className="text-muted-foreground">
              We use essential cookies to maintain your session and preferences. We also use analytics 
              cookies through Vercel Analytics to understand how visitors use our site. These cookies 
              do not track you across other websites.
            </p>
          </section>

          <section>
            <h2 className="mb-4 text-2xl font-semibold">Security</h2>
            <p className="text-muted-foreground">
              We implement appropriate technical and organizational measures to protect your personal 
              information. All data is transmitted over HTTPS, and sensitive information is encrypted 
              at rest.
            </p>
          </section>

          <section>
            <h2 className="mb-4 text-2xl font-semibold">Changes to This Policy</h2>
            <p className="text-muted-foreground">
              We may update this Privacy Policy from time to time. We will notify you of any changes 
              by posting the new Privacy Policy on this page and updating the &ldquo;Last updated&rdquo; date.
            </p>
          </section>

          <section>
            <h2 className="mb-4 text-2xl font-semibold">Contact Us</h2>
            <p className="text-muted-foreground">
              If you have any questions about this Privacy Policy or our data practices, please{" "}
              <Link href="/contact" className="text-primary hover:underline">
                contact us
              </Link>
              .
            </p>
          </section>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t px-4 py-8 sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-3xl flex-col items-center justify-between gap-4 text-sm text-muted-foreground sm:flex-row">
          <p>© {new Date().getFullYear()} Junkyard Index</p>
          <div className="flex gap-6">
            <Link href="/" className="hover:text-foreground transition-colors">
              Home
            </Link>
            <Link href="/contact" className="hover:text-foreground transition-colors">
              Contact
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
