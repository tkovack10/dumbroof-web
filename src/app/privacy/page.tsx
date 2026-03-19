import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy — DumbRoof.ai",
  description: "Privacy policy for DumbRoof.ai claim processing platform.",
};

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-white">
      {/* Nav */}
      <nav className="bg-[var(--navy)] border-b border-white/10">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <a href="/" className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-[var(--red)] flex items-center justify-center font-bold text-white text-sm">
              DR
            </div>
            <span className="text-white font-bold text-lg tracking-tight">
              dumb roof<sup className="text-[9px] font-medium align-super ml-0.5">™</sup>
            </span>
          </a>
          <a
            href="/dashboard"
            className="text-gray-400 hover:text-white text-sm transition-colors"
          >
            Dashboard
          </a>
        </div>
      </nav>

      {/* Content */}
      <article className="max-w-3xl mx-auto px-6 py-12">
        <h1 className="text-3xl font-bold text-[var(--navy)] mb-2">
          Privacy Policy
        </h1>
        <p className="text-gray-400 text-sm mb-10">
          Effective Date: March 18, 2026 &middot; Last Updated: March 18, 2026
        </p>

        <div className="prose prose-gray max-w-none text-[15px] leading-relaxed [&_h2]:text-xl [&_h2]:font-bold [&_h2]:text-[var(--navy)] [&_h2]:mt-10 [&_h2]:mb-4 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-[var(--navy)] [&_h3]:mt-6 [&_h3]:mb-2 [&_p]:mb-4 [&_p]:text-gray-600">
          <h2>1. Introduction</h2>
          <p>
            Dumb Roof Technologies, LLC (&ldquo;DumbRoof,&rdquo; &ldquo;we,&rdquo;
            &ldquo;us,&rdquo; or &ldquo;our&rdquo;) operates the DumbRoof.ai
            platform (&ldquo;Platform&rdquo;), a cloud-based claim processing and
            management service for roofing contractors, public adjusters, and
            insurance restoration professionals. This Privacy Policy describes how
            we collect, use, disclose, and protect information when you use our
            Platform, website (www.dumbroof.ai), and related services.
          </p>
          <p>
            By creating an account or using the Platform, you agree to the
            collection and use of information in accordance with this policy. If
            you do not agree, please do not use the Platform.
          </p>

          <h2>2. Information We Collect</h2>

          <h3>2.1 Account Information</h3>
          <p>
            When you create an account, we collect your name, email address, phone
            number, company name, company address, and professional title. If you
            connect a payment method, your billing information is processed by our
            third-party payment processor (Stripe) and we do not store full payment
            card numbers.
          </p>

          <h3>2.2 Claim Data</h3>
          <p>
            When you use the Platform to process insurance claims, we receive and
            store claim-related documents and data that you upload or that are
            generated through the Platform. This includes but is not limited to:
            carrier scopes of loss, property measurements (e.g., EagleView
            reports), photographs of property damage, homeowner names and property
            addresses, insurance claim numbers, financial figures (estimates,
            invoices, carrier payments), and correspondence with insurance carriers.
          </p>

          <h3>2.3 Email Integration Data</h3>
          <p>
            If you choose to connect your Gmail account via our OAuth integration
            (available on select subscription tiers), we store an encrypted
            refresh token that allows the Platform to send emails on your behalf
            and, on eligible tiers, to retrieve claim-related correspondence.
            We request Gmail &ldquo;send&rdquo; and &ldquo;read-only&rdquo;
            scopes. The read-only scope is used exclusively to search for emails
            that contain insurance claim numbers in the subject line — we do not
            read your personal emails, access your contacts, or scan your full
            inbox. Only emails matching active claim numbers associated with your
            account are retrieved and displayed within the Claim Brain interface.
            Email send and read capabilities may vary by subscription tier.
            You may disconnect your Gmail at any time from the Settings page,
            which immediately revokes our access.
          </p>

          <h3>2.4 Usage and Analytics Data</h3>
          <p>
            We automatically collect technical information when you use the
            Platform, including IP address, browser type, device information, pages
            visited, features used, and timestamps. We use this data to improve
            performance, diagnose issues, and understand how the Platform is used.
          </p>

          <h2>3. How We Use Your Information</h2>
          <p>We use the information we collect to:</p>
          <p>
            <strong>Provide and operate the Platform</strong> — process your claims,
            generate documents (forensic reports, estimates, invoices, certificates
            of completion), send emails you authorize, retrieve carrier
            correspondence related to your active claims, and deliver the core
            functionality of the service.
          </p>
          <p>
            <strong>Quality control and compliance</strong> — Platform administrators
            may review claim data and user activity to ensure compliance with our
            Terms of Service, verify data integrity, prevent fraud or misuse, and
            maintain the quality of our AI-generated outputs. This administrative
            access is essential to operating a reliable claims processing platform.
          </p>
          <p>
            <strong>Improve our AI models and services</strong> — We use
            de-identified and aggregated claim data to train, evaluate, and improve
            our machine learning models, pricing databases, damage assessment
            algorithms, and carrier intelligence systems. This continuous improvement
            is fundamental to providing accurate estimates, identifying carrier
            underpayment patterns, and generating effective claim documentation.
          </p>
          <p>
            <strong>Communicate with you</strong> — send service-related
            notifications, respond to support requests, and provide updates about
            your account or the Platform.
          </p>
          <p>
            <strong>Billing and payments</strong> — process subscription payments,
            manage your plan, and enforce usage limits.
          </p>

          <h2>4. Administrative Access to User Data</h2>
          <p>
            DumbRoof administrators have access to all claim data submitted by
            users of the Platform. This access is necessary for:
          </p>
          <p>
            <strong>Quality assurance</strong> — reviewing AI-generated documents
            for accuracy, ensuring estimates use correct pricing and building codes,
            and verifying that outputs meet professional standards before they are
            sent to insurance carriers.
          </p>
          <p>
            <strong>Terms of Service enforcement</strong> — monitoring for misuse,
            fraudulent claims, or violations of our acceptable use policy. We take
            the integrity of the insurance claims process seriously and reserve the
            right to suspend accounts that submit fraudulent or misleading
            information.
          </p>
          <p>
            <strong>Platform improvement</strong> — identifying common issues,
            training our AI systems on real-world claim scenarios, and building
            carrier-specific intelligence that benefits all users.
          </p>
          <p>
            Administrative access is limited to authorized DumbRoof personnel and
            is governed by internal access controls.
          </p>

          <h2>5. Information Sharing and Disclosure</h2>
          <p>
            <strong>
              We do not sell, rent, or share your personal information or claim
              data with outside parties.
            </strong>
          </p>
          <p>We may disclose information only in the following circumstances:</p>
          <p>
            <strong>Service providers</strong> — We use third-party services to
            operate the Platform, including Supabase (database hosting), Vercel (web
            hosting), Railway (backend hosting), Anthropic (AI processing), Stripe
            (payments), Resend (transactional email), and Google (Gmail OAuth, Maps
            API). These providers process data only as necessary to provide their
            services to us and are bound by their own privacy policies and data
            processing agreements.
          </p>
          <p>
            <strong>Legal requirements</strong> — We may disclose information if
            required by law, subpoena, court order, or other legal process, or if
            we believe in good faith that disclosure is necessary to protect our
            rights, protect your safety or the safety of others, investigate fraud,
            or respond to a government request.
          </p>
          <p>
            <strong>Business transfers</strong> — In the event of a merger,
            acquisition, or sale of all or a portion of our assets, user information
            may be transferred as part of that transaction. We will notify you via
            email or prominent notice on the Platform before your information becomes
            subject to a different privacy policy.
          </p>

          <h2>6. Data Security</h2>
          <p>
            We implement commercially reasonable technical and organizational
            measures to protect your information against unauthorized access, loss,
            destruction, or alteration. These measures include encryption of data in
            transit (TLS) and at rest, role-based access controls, secure
            authentication (including support for two-factor authentication), and
            regular security reviews. However, no method of transmission over the
            Internet or electronic storage is 100% secure, and we cannot guarantee
            absolute security.
          </p>

          <h2>7. Data Retention</h2>
          <p>
            We retain your account information and claim data for as long as your
            account is active or as needed to provide you services. If you request
            deletion of your account, we will delete or de-identify your personal
            information within 90 days, except where we are required to retain it
            for legal, regulatory, or legitimate business purposes (such as
            maintaining aggregated model training data that cannot be linked back to
            you).
          </p>

          <h2>8. Your Rights and Choices</h2>
          <p>
            <strong>Access and correction</strong> — You may access, update, or
            correct your account information at any time through the Settings page
            on the Platform.
          </p>
          <p>
            <strong>Data export</strong> — You may request an export of your claim
            data by contacting us at the email address below.
          </p>
          <p>
            <strong>Account deletion</strong> — You may request deletion of your
            account and associated data by contacting us. We will process your
            request within 90 days.
          </p>
          <p>
            <strong>Email integration</strong> — You may disconnect your Gmail
            integration at any time from Settings, which immediately revokes all
            Platform access to your Gmail account.
          </p>
          <p>
            <strong>Communications</strong> — You may opt out of non-essential
            communications by contacting us or using the unsubscribe link in our
            emails.
          </p>

          <h2>9. State-Specific Privacy Rights</h2>
          <p>
            If you are a resident of California, Pennsylvania, New York, New
            Jersey, or another state with consumer privacy legislation, you may have
            additional rights under applicable law, including the right to know what
            personal information we collect, the right to request deletion, and the
            right to opt out of certain data practices. To exercise any of these
            rights, please contact us using the information below. We will respond
            to verifiable requests within the timeframes required by applicable law.
          </p>

          <h2>10. Children&apos;s Privacy</h2>
          <p>
            The Platform is not directed to individuals under the age of 18. We do
            not knowingly collect personal information from children. If we become
            aware that we have collected personal information from a child, we will
            take steps to delete that information promptly.
          </p>

          <h2>11. Changes to This Policy</h2>
          <p>
            We may update this Privacy Policy from time to time. We will notify you
            of material changes by posting the updated policy on this page and
            updating the &ldquo;Last Updated&rdquo; date. Your continued use of the
            Platform after changes are posted constitutes your acceptance of the
            revised policy.
          </p>

          <h2>12. Contact Us</h2>
          <p>
            If you have questions about this Privacy Policy or wish to exercise
            your privacy rights, please contact us:
          </p>
          <p>
            <strong>Dumb Roof Technologies, LLC</strong>
            <br />
            3070 Bristol Pike, Building 1, Suite 122
            <br />
            Bensalem, PA 19020
            <br />
            Email: privacy@dumbroof.ai
            <br />
            Phone: (267) 332-0197
          </p>
        </div>
      </article>

      {/* Footer */}
      <footer className="border-t border-gray-100 py-8 text-center text-sm text-gray-400">
        &copy; {new Date().getFullYear()} Dumb Roof Technologies, LLC. All rights
        reserved.
      </footer>
    </main>
  );
}
