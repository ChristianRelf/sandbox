"use client";

import { Check,Copy,Share2 } from "lucide-react";
import { useState } from "react";

export function CopyReferralButton({url}:{url:string}){
  const[copied,setCopied]=useState(false);
  async function copy(){
    if(navigator.clipboard)await navigator.clipboard.writeText(url);
    else{
      const field=document.createElement("textarea");field.value=url;field.setAttribute("readonly","");field.style.position="fixed";field.style.opacity="0";document.body.append(field);field.select();document.execCommand("copy");field.remove();
    }
    setCopied(true);
    window.setTimeout(()=>setCopied(false),2_000);
  }
  async function share(){
    if(navigator.share){try{await navigator.share({title:"Try sndbox",text:"Build local-first automations with sndbox. We both get $5 cloud credit after your first qualifying top-up.",url});}catch(error){if((error as DOMException).name!=="AbortError")throw error;}return;}
    await copy();
  }
  return <div className="referral-actions"><button className="portal-primary" type="button" onClick={copy}>{copied?<Check aria-hidden="true"/>:<Copy aria-hidden="true"/>}{copied?"Copied":"Copy invite link"}</button><button className="portal-secondary" type="button" onClick={share}><Share2 aria-hidden="true"/>Share</button></div>;
}
