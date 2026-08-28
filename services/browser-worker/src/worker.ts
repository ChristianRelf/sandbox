import { mkdtemp,rm,stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium,type Browser,type BrowserContext,type Page } from "playwright";
import { BrowserNetworkPolicy } from "./network-policy.js";
import { cloudProfileSchema,type CloudProfile } from "./profiles.js";
import type { UsageReporter } from "./usage.js";

export type BrowserStep={type:"navigate";url:string}|{type:"click";selector:string}|{type:"fill";selector:string;value:string;sensitive?:boolean}|{type:"select";selector:string;value:string}|{type:"press_key";selector?:string;key:string}|{type:"wait";milliseconds:number}|{type:"extract";selector:string}|{type:"screenshot";name:string}|{type:"upload";selector:string;artifactPath:string}|{type:"download";selector:string}|{type:"close"};
export interface BrowserExecution {executionId:string;workspaceId:string;environmentId:string;deploymentId:string;region:string;profile:CloudProfile|null;steps:BrowserStep[];maximumArtifactBytes:number;allowedUploadRoots:string[]}
export interface ArtifactScanner {scan(filePath:string):Promise<"clean"|"malicious"|"unknown">}
export interface ArtifactSink {upload(filePath:string,metadata:{executionId:string;workspaceId:string;contentType:string}):Promise<string>}
export interface NetworkPolicy {inspect(url:string):Promise<{allowed:boolean;reason:string|null;resolvedAddresses:string[]}>}
export interface BrowserExecutionResult {outputs:unknown[];artifacts:{reference:string;sizeBytes:number}[];blockedRequests:{url:string;reason:string}[];sandboxDestroyed:boolean}

export class ManagedBrowserWorker {
  constructor(private readonly networkPolicy:NetworkPolicy=new BrowserNetworkPolicy(),private readonly scanner:ArtifactScanner={scan:async()=>"unknown"},private readonly artifactSink:ArtifactSink={upload:async()=>{throw new Error("No durable artifact sink is configured.");}},private readonly usageReporter?:UsageReporter){}
  async execute(input:BrowserExecution):Promise<BrowserExecutionResult>{
    const usageStartedAt=new Date(),usageStarted=performance.now();
    const profile=input.profile?cloudProfileSchema.parse(input.profile):null;if(profile&&profile.workspaceId!==input.workspaceId)throw new Error("Cloud browser profile belongs to another workspace.");
    const root=await mkdtemp(path.join(tmpdir(),`sandbox-browser-${input.executionId}-`));let browser:Browser|undefined,context:BrowserContext|undefined;const result:BrowserExecutionResult={outputs:[],artifacts:[],blockedRequests:[],sandboxDestroyed:false};
    try{
      browser=await chromium.launch({headless:true,args:["--disable-extensions","--disable-component-extensions-with-background-pages","--no-first-run"]});
      context=await browser.newContext({viewport:profile?.viewport??{width:1280,height:800},locale:profile?.locale??"en-GB",timezoneId:profile?.timeZone??"UTC",acceptDownloads:true,serviceWorkers:"block"});
      await context.route("**/*",async route=>{const decision=await this.networkPolicy.inspect(route.request().url());if(decision.allowed)await route.continue();else{result.blockedRequests.push({url:redactUrl(route.request().url()),reason:decision.reason??"blocked"});await route.abort("blockedbyclient");}});
      const page=await context.newPage();
      for(const step of input.steps){if(step.type==="close")break;await this.runStep(page,step,root,input,result.outputs,result.artifacts);}
      return result;
    }finally{await context?.close().catch(()=>undefined);await browser?.close().catch(()=>undefined);await rm(root,{recursive:true,force:true});result.sandboxDestroyed=true;const usageEndedAt=new Date();await this.usageReporter?.recordBrowserSeconds(input,usageStartedAt,usageEndedAt,Math.max(1,Math.ceil((performance.now()-usageStarted)/1000)));}
  }
  private async runStep(page:Page,step:Exclude<BrowserStep,{type:"close"}>,root:string,input:BrowserExecution,outputs:unknown[],artifacts:{reference:string;sizeBytes:number}[]):Promise<void>{
    switch(step.type){
      case"navigate":{const decision=await this.networkPolicy.inspect(step.url);if(!decision.allowed)throw new Error(`Navigation blocked: ${decision.reason}.`);await page.goto(step.url,{waitUntil:"domcontentloaded"});break;}
      case"click":await page.locator(step.selector).click();break;
      case"fill":await page.locator(step.selector).fill(step.value);break;
      case"select":await page.locator(step.selector).selectOption(step.value);break;
      case"press_key":await (step.selector?page.locator(step.selector):page.locator("body")).press(step.key);break;
      case"wait":await page.waitForTimeout(Math.min(Math.max(step.milliseconds,0),120_000));break;
      case"extract":outputs.push(await page.locator(step.selector).allTextContents());break;
      case"screenshot":{const destination=path.join(root,safeName(step.name,"screenshot.png"));await page.screenshot({path:destination,mask:await sensitiveMasks(page)});await this.acceptArtifact(destination,input,artifacts,false);break;}
      case"upload":{if(!insideAllowedRoot(step.artifactPath,input.allowedUploadRoots))throw new Error("Upload artifact is outside approved roots.");await page.locator(step.selector).setInputFiles(step.artifactPath);break;}
      case"download":{const [download]=await Promise.all([page.waitForEvent("download"),page.locator(step.selector).click()]);const destination=path.join(root,safeName(download.suggestedFilename(),"download.bin"));await download.saveAs(destination);await this.acceptArtifact(destination,input,artifacts,true);break;}
    }
  }
  private async acceptArtifact(filePath:string,input:BrowserExecution,artifacts:{reference:string;sizeBytes:number}[],scan:boolean){const details=await stat(filePath);if(details.size>input.maximumArtifactBytes)throw new Error("Browser artifact exceeds the configured limit.");if(scan&&(await this.scanner.scan(filePath))!=="clean")throw new Error("Downloaded artifact did not pass malware scanning.");const reference=await this.artifactSink.upload(filePath,{executionId:input.executionId,workspaceId:input.workspaceId,contentType:path.extname(filePath)===".png"?"image/png":"application/octet-stream"});artifacts.push({reference,sizeBytes:details.size});}
}
function redactUrl(raw:string){try{const value=new URL(raw);value.username="";value.password="";value.search="";value.hash="";return value.toString();}catch{return"[invalid-url]";}}
function safeName(value:string,fallback:string){const cleaned=path.basename(value).replace(/[^a-zA-Z0-9._-]/g,"_");return cleaned||fallback;}
function insideAllowedRoot(file:string,roots:string[]){const resolved=path.resolve(file);return roots.some(root=>{const base=path.resolve(root);return resolved===base||resolved.startsWith(`${base}${path.sep}`);});}
async function sensitiveMasks(page:Page){return[page.locator('input[type="password"]'),page.locator('[data-sensitive="true"]')];}
