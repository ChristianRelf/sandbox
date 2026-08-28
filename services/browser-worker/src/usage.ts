import { createHmac,randomUUID } from "node:crypto";

export interface ManagedUsageContext {
  workspaceId:string;
  environmentId:string;
  executionId:string;
  deploymentId:string;
  region:string;
}

export interface UsageReporter {
  recordBrowserSeconds(context:ManagedUsageContext,startedAt:Date,endedAt:Date,quantity:number):Promise<void>;
}

export class HttpUsageReporter implements UsageReporter {
  constructor(private readonly baseUrl:string,private readonly producerId:string,private readonly secret:Buffer) {
    if (secret.length<32) throw new Error("Usage producer secret requires at least 32 bytes.");
  }
  async recordBrowserSeconds(context:ManagedUsageContext,startedAt:Date,endedAt:Date,quantity:number):Promise<void> {
    const body={eventId:randomUUID(),workspaceId:context.workspaceId,environmentId:context.environmentId,executionId:context.executionId,deploymentId:context.deploymentId,meter:"managed_browser_seconds",quantity,unit:"seconds",sourceEventId:`managed-browser-stop:${context.executionId}`,idempotencyKey:`managed-browser-usage:${context.executionId}`,periodStartedAt:startedAt.toISOString(),periodEndedAt:endedAt.toISOString(),region:context.region,metadata:{producer:this.producerId}};
    const serialized=JSON.stringify(body),timestamp=Math.floor(Date.now()/1000).toString(),signature=createHmac("sha256",this.secret).update(`${timestamp}.${serialized}`).digest("hex");
    let failure="Usage ingestion did not complete.";
    for(let attempt=0;attempt<3;attempt+=1){
      try{
        const response=await fetch(`${this.baseUrl.replace(/\/$/,"")}/v1/internal/usage-events`,{method:"POST",headers:{"content-type":"application/json","x-sandbox-usage-producer":this.producerId,"x-sandbox-usage-timestamp":timestamp,"x-sandbox-usage-signature":signature},body:serialized,signal:AbortSignal.timeout(10_000)});
        if(response.ok)return;
        failure=`Usage ingestion failed with HTTP ${response.status}.`;
        if(response.status<500&&response.status!==429)break;
      }catch(error){failure=`Usage ingestion failed: ${error instanceof Error?error.message:String(error)}`;}
      if(attempt<2)await new Promise(resolve=>setTimeout(resolve,100*2**attempt));
    }
    throw new Error(failure);
  }
}
