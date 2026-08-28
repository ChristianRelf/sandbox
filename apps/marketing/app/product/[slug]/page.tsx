import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { productPages } from "@sandbox/content";
import { ProductPageView } from "../../../components/ProductPageView";
type Params = Promise<{slug:string}>;
export function generateStaticParams(){return productPages.map(({slug})=>({slug}));}
export async function generateMetadata({params}:{params:Params}):Promise<Metadata>{const {slug}=await params;const page=productPages.find(item=>item.slug===slug);return page?{title:page.eyebrow,description:page.summary,alternates:{canonical:`/product/${slug}`}}:{};}
export default async function Page({params}:{params:Params}){const {slug}=await params;const page=productPages.find(item=>item.slug===slug);if(!page)notFound();return <ProductPageView page={page}/>;}
