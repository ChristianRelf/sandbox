import Link from "next/link";
import {
  ArrowRight,
  BookOpen,
  Download,
  LifeBuoy,
  ShieldAlert,
} from "lucide-react";
export const metadata = {
  title: "Support",
  description:
    "Find Sandbox documentation, downloads, troubleshooting and governed support access.",
};
export default function Page() {
  return (
    <main id="content" className="index-page support-page">
      <header>
        <p className="eyebrow">
          <span />
          Support centre
        </p>
        <h1>
          Find the failed step.
          <br />
          Then fix the cause.
        </h1>
        <p>
          Start with execution-specific troubleshooting, then review governed
          diagnostic access from your account when support requests it.
        </p>
      </header>
      <section className="support-actions">
        <a href="https://docs.sndbox.app/troubleshooting">
          <BookOpen />
          <h2>Search documentation</h2>
          <p>Browse execution, browser, connection and runner errors.</p>
          <ArrowRight />
        </a>
        <Link href="/downloads">
          <Download />
          <h2>Downloads</h2>
          <p>Check release availability, requirements and integrity.</p>
          <ArrowRight />
        </Link>
        <a href="https://app.sndbox.app/support">
          <LifeBuoy />
          <h2>Support access</h2>
          <p>
            Review time-boxed diagnostic access requests and their audit status.
          </p>
          <ArrowRight />
        </a>
        <Link href="/legal/vulnerability-disclosure">
          <ShieldAlert />
          <h2>Report a vulnerability</h2>
          <p>Use the responsible disclosure process for security issues.</p>
          <ArrowRight />
        </Link>
      </section>
    </main>
  );
}
