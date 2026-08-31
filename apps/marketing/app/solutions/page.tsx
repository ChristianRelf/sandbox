import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useCases } from "@sandbox/content";
export const metadata={title:"Automation solutions",description:"Practical local-first automation workflows for browsers, files, developers and private networks."};
export default function Page(){return <main id="content" className="index-page"><header><p className="eyebrow"><span/>Solutions</p><h1>Start with the work<br/>you already repeat.</h1><p>Focused examples built from nodes that exist in sndbox today.</p></header><section className="case-grid">{useCases.map((item,index)=><Link href={`/solutions/${item.slug}`} key={item.slug}><span>0{index+1}</span><h2>{item.title}</h2><p>{item.problem}</p><small>{item.target}</small><ArrowRight size={15}/></Link>)}</section></main>}
