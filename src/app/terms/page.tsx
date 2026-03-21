import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service — DumbRoof.ai",
  description: "Terms of service for the DumbRoof.ai claim processing platform.",
};

export default function TermsPage() {
  return (
    <main className="min-h-screen">
      {/* Nav */}
      <nav className="bg-[rgba(6,9,24,0.85)] backdrop-blur-[20px] border-b border-[var(--border-glass)] sticky top-0 z-50">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <a href="/" className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-[var(--pink)] to-[var(--blue)] flex items-center justify-center font-bold text-white text-xs text-sm">
              DR
            </div>
            <span className="text-white font-bold text-lg tracking-tight">
              dumb roof<sup className="text-[9px] font-medium align-super ml-0.5">™</sup>
            </span>
          </a>
          <a
            href="/dashboard"
            className="text-[var(--gray-dim)] hover:text-white text-sm transition-colors"
          >
            Dashboard
          </a>
        </div>
      </nav>

      {/* Content */}
      <article className="max-w-3xl mx-auto px-6 py-12">
        <h1 className="text-3xl font-bold text-[var(--white)] mb-2">
          Terms of Service
        </h1>
        <p className="text-[var(--gray-dim)] text-sm mb-10">
          Effective Date: March 18, 2026 &middot; Last Updated: March 18, 2026
        </p>

        <div className="prose prose-invert max-w-none text-[15px] leading-relaxed [&_h2]:text-xl [&_h2]:font-bold [&_h2]:text-[var(--white)] [&_h2]:mt-10 [&_h2]:mb-4 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-[var(--white)] [&_h3]:mt-6 [&_h3]:mb-2 [&_p]:mb-4 [&_p]:text-[var(--gray)]">
          <h2>1. Acceptance of Terms</h2>
          <p>
            By accessing or using the DumbRoof.ai platform (&ldquo;Platform&rdquo;)
            operated by Dumb Roof Technologies, LLC (&ldquo;DumbRoof,&rdquo;
            &ldquo;we,&rdquo; &ldquo;us&rdquo;), you agree to be bound by these
            Terms of Service (&ldquo;Terms&rdquo;). If you are using the Platform
            on behalf of an organization, you represent that you have the authority
            to bind that organization to these Terms.
          </p>

          <h2>2. Description of Service</h2>
          <p>
            DumbRoof.ai is an AI-powered claim processing platform that helps
            roofing contractors, public adjusters, and insurance restoration
            professionals manage insurance claims. The Platform provides document
            analysis, estimate generation, photo annotation, scope comparison,
            email management, and related tools. All AI-generated outputs are
            intended as professional aids and should be reviewed by a qualified
            professional before submission to insurance carriers or other parties.
          </p>

          <h2>3. Account Registration</h2>
          <p>
            You must create an account to use the Platform. You agree to provide
            accurate and complete information during registration and to keep your
            account information current. You are responsible for maintaining the
            confidentiality of your login credentials and for all activities that
            occur under your account. You must notify us immediately of any
            unauthorized use of your account.
          </p>

          <h2>4. Acceptable Use</h2>
          <p>You agree to use the Platform only for lawful purposes and in accordance with these Terms. You agree not to:</p>
          <p>
            Submit fraudulent, misleading, or fabricated claim information.
            Use the Platform to file or support insurance claims that you know to
            be false or inflated. Attempt to circumvent security measures, access
            other users&apos; accounts or data, or interfere with the operation of
            the Platform. Reverse engineer, decompile, or disassemble any part of
            the Platform. Use the Platform in any way that violates applicable
            federal, state, or local laws, including insurance regulations such as
            the Unfair Claims Settlement Practices Act (UCSPA) or state-specific
            public adjuster licensing requirements.
          </p>

          <h2>5. Subscription and Payment</h2>
          <p>
            Access to the Platform requires an active subscription. Subscription
            plans, pricing, and claim limits are described on our pricing page and
            may change with notice. Payments are processed through Stripe.
            Subscriptions renew automatically unless canceled before the renewal
            date. Refunds are issued at our sole discretion. We reserve the right
            to modify pricing with 30 days&apos; notice.
          </p>

          <h2>6. Your Data</h2>
          <p>
            You retain ownership of all claim data, documents, and photographs you
            upload to the Platform. By uploading content, you grant DumbRoof a
            non-exclusive, worldwide license to use, process, store, and analyze
            your content as necessary to provide the service, enforce these Terms,
            and improve our AI models and Platform capabilities. This license
            survives termination of your account with respect to de-identified and
            aggregated data used for model improvement.
          </p>
          <p>
            You are solely responsible for ensuring that you have the right to
            upload all content you submit, including photographs, documents, and
            personal information of third parties such as homeowners.
          </p>

          <h2>7. Administrative Access and Quality Control</h2>
          <p>
            You acknowledge and agree that DumbRoof administrators may access,
            review, and analyze your claim data for the purposes of quality
            assurance, compliance verification, Terms of Service enforcement, and
            Platform improvement. This access is a core part of our service — it
            allows us to ensure the accuracy of AI-generated documents, monitor
            for misuse, and continuously improve our systems for all users.
          </p>

          <h2>8. AI-Generated Content</h2>
          <p>
            The Platform uses artificial intelligence to generate documents,
            estimates, analyses, and recommendations. While we strive for accuracy,
            AI-generated outputs may contain errors, omissions, or inaccuracies.
            You are responsible for reviewing all AI-generated content before use.
            DumbRoof is not liable for any damages arising from reliance on
            AI-generated outputs without professional review.
          </p>

          <h2>9. Compliance</h2>
          <p>
            The Platform generates different content depending on the user&apos;s
            role (contractor, public adjuster, attorney, homeowner). Contractors
            using the Platform must comply with the Unauthorized Practice of Public
            Adjusting (UPPA) restrictions in their state. The Platform is designed
            to enforce compliance boundaries, but it is ultimately your
            responsibility to ensure that your use of the Platform and its outputs
            complies with all applicable laws and licensing requirements.
          </p>

          <h2>10. Email Integration</h2>
          <p>
            Email integration features, including the ability to send and read
            claim-related emails through the Platform, are available on select
            subscription tiers. If you connect your email account (e.g., Gmail
            via OAuth), you authorize the Platform to send emails on your behalf
            when you approve them through the Claim Brain interface, and, on
            eligible tiers, to retrieve emails that match your active claim
            numbers. The Platform only reads emails containing claim numbers in
            the subject line and does not access personal correspondence. You are
            responsible for the content of all emails sent from your account
            through the Platform. You may revoke email access at any time through
            the Settings page.
          </p>

          <h2>11. Intellectual Property</h2>
          <p>
            The Platform, including its software, AI models, design, carrier
            intelligence databases, and documentation, is the property of Dumb
            Roof Technologies, LLC and is protected by intellectual property laws.
            Your subscription grants you a limited, non-exclusive, non-transferable
            right to use the Platform during your subscription period.
          </p>

          <h2>12. Limitation of Liability</h2>
          <p>
            To the fullest extent permitted by law, DumbRoof shall not be liable
            for any indirect, incidental, special, consequential, or punitive
            damages, or any loss of profits or revenues, whether incurred directly
            or indirectly, or any loss of data, use, goodwill, or other intangible
            losses, resulting from your use of or inability to use the Platform.
            Our total liability for any claim arising from these Terms or the
            Platform shall not exceed the amount you paid us in the 12 months
            preceding the claim.
          </p>

          <h2>13. Indemnification</h2>
          <p>
            You agree to indemnify and hold harmless DumbRoof, its officers,
            directors, employees, and agents from any claims, damages, losses,
            liabilities, costs, and expenses (including reasonable attorneys&apos;
            fees) arising out of your use of the Platform, your violation of these
            Terms, or your violation of any rights of a third party.
          </p>

          <h2>14. Termination</h2>
          <p>
            We may suspend or terminate your account at any time for violation of
            these Terms, fraudulent activity, or any other reason at our sole
            discretion. Upon termination, your right to use the Platform ceases
            immediately. You may request an export of your data within 30 days of
            termination.
          </p>

          <h2>15. Governing Law</h2>
          <p>
            These Terms are governed by the laws of the Commonwealth of
            Pennsylvania, without regard to its conflict of law principles. Any
            disputes arising from these Terms shall be resolved in the state or
            federal courts located in Bucks County, Pennsylvania.
          </p>

          <h2>16. Changes to Terms</h2>
          <p>
            We may modify these Terms at any time. We will notify you of material
            changes by posting the updated Terms on this page and, for significant
            changes, by email. Your continued use of the Platform after changes are
            posted constitutes acceptance of the modified Terms.
          </p>

          <h2>17. Contact</h2>
          <p>
            <strong>Dumb Roof Technologies, LLC</strong>
            <br />
            3070 Bristol Pike, Building 1, Suite 122
            <br />
            Bensalem, PA 19020
            <br />
            Email: legal@dumbroof.ai
            <br />
            Phone: (267) 332-0197
          </p>
        </div>
      </article>

      {/* Footer */}
      <footer className="border-t border-white/[0.04] py-8 text-center text-sm text-[var(--gray-dim)]">
        &copy; {new Date().getFullYear()} Dumb Roof Technologies, LLC. All rights
        reserved.
      </footer>
    </main>
  );
}
