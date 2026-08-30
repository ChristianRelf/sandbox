import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { productPages } from "@sandbox/content";
import { ProductPageView } from "../../../components/ProductPageView";

type Params = Promise<{ slug: string }>;

export function generateStaticParams() {
  return productPages.map(({ slug }) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const page = productPages.find((item) => item.slug === slug);
  if (!page) return {};

  return {
    title: page.eyebrow,
    description: page.summary,
    alternates: { canonical: slug === "developers" ? "/developers" : `/product/${slug}` },
    openGraph: { title: page.eyebrow, description: page.summary, url: slug === "developers" ? "/developers" : `/product/${slug}`, images: [] },
    twitter: { title: page.eyebrow, description: page.summary, images: [] },
  };
}

export default async function Page({ params }: { params: Params }) {
  const { slug } = await params;
  const page = productPages.find((item) => item.slug === slug);
  if (!page) notFound();
  return <ProductPageView page={page} />;
}
