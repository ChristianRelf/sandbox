import Link from "next/link";
import { ArrowRight } from "lucide-react";
const items = [
  "SSO configuration and SCIM provisioning",
  "Custom roles and separation of duties",
  "Audit history",
  "Self-hosted runners",
  "Private plugins",
  "Environment and policy controls",
  "Retention controls",
  "Support-access approval",
];
export const metadata = {
  title: "Enterprise",
  description:
    "Governed visual automation for private networks and controlled infrastructure.",
};
export default function Page() {
  return (
    <main id="content" className="detail-page enterprise-page">
      <section className="detail-hero">
        <p className="eyebrow">
          <span />
          Enterprise
        </p>
        <h1>Automation that can live inside your boundary.</h1>
        <p>
          Give technical teams a visual workflow platform while keeping
          identity, infrastructure, policies and support access governed.
        </p>
        <Link
          href="/contact?type=enterprise"
          className="sb-button sb-button--primary"
        >
          Contact sales <ArrowRight size={14} />
        </Link>
        <a
          className="text-action"
          href="https://docs.sndbox.app/administration/security-centre"
        >
          Read security documentation
        </a>
      </section>
      <section className="enterprise-list">
        {items.map((item) => (
          <article key={item}>
            <h2>{item}</h2>
          </article>
        ))}
      </section>
    </main>
  );
}
