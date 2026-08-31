import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { useCases } from "@sandbox/content";
import { SolutionExperience } from "../../../components/SolutionExperiences";

type Params = Promise<{ slug: string }>;

export function generateStaticParams() {
  return useCases.map(({ slug }) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const item = useCases.find((value) => value.slug === slug);
  if (!item) return {};
  return {
    title: item.title,
    description: item.problem,
    alternates: { canonical: `/solutions/${item.slug}` },
  };
}

export default async function Page({ params }: { params: Params }) {
  const { slug } = await params;
  const item = useCases.find((value) => value.slug === slug);
  if (!item) notFound();
  return <SolutionExperience item={item} />;
}
