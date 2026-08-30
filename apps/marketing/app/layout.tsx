import type { Metadata } from "next";
import { brand } from "@sandbox/brand";
import { SiteFooter } from "./SiteFooter";
import { SiteHeader } from "./SiteHeader";
import "./globals.css";

const shareTitle = "Make the work move. Keep the control.";
const shareDescription = "Visual automation for browsers, files, apps and APIs, running on your machine or a runner you choose.";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_MARKETING_URL ?? brand.domains.marketing),
  title: {
    default: brand.name + " - Visual automation under your control",
    template: "%s - " + brand.name,
  },
  description: shareDescription,
  openGraph: {
    type: "website",
    siteName: brand.name,
    title: shareTitle,
    description: shareDescription,
    images: [{ url: "/og.png", width: 1200, height: 630, alt: shareTitle }],
  },
  twitter: {
    card: "summary_large_image",
    title: shareTitle,
    description: shareDescription,
    images: ["/og.png"],
  },
};

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body>
        <a className="skip-link" href="#content">Skip to content</a>
        <SiteHeader />
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}
