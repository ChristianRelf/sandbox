import type { Metadata } from "next";
import { productPages } from "@sandbox/content";
import { ProductPageView } from "../../components/ProductPageView";

const developerPage = productPages.find((page) => page.slug === "developers")!;

export const metadata: Metadata = {
  title: developerPage.eyebrow,
  description: developerPage.summary,
  alternates: { canonical: "/developers" },
  openGraph: { title: developerPage.eyebrow, description: developerPage.summary, url: "/developers", images: [] },
  twitter: { title: developerPage.eyebrow, description: developerPage.summary, images: [] },
};

export default function Page() {
  return <ProductPageView page={developerPage} />;
}
