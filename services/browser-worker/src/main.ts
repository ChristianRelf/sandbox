import { createHash } from "node:crypto";
import { copyFile,mkdir } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import { ManagedBrowserWorker,type ArtifactScanner,type ArtifactSink,type BrowserExecution } from "./worker.js";

const artifactDirectory=process.env.SANDBOX_ARTIFACT_DIRECTORY;
if(!artifactDirectory)throw new Error("SANDBOX_ARTIFACT_DIRECTORY is required.");
const scanner:ArtifactScanner={scan:async()=>process.env.SANDBOX_DOWNLOAD_SCANNER_READY==="true"?"clean":"unknown"};
const sink:ArtifactSink={upload:async(file,metadata)=>{const directory=path.join(artifactDirectory,metadata.workspaceId,metadata.executionId);await mkdir(directory,{recursive:true});const digest=createHash("sha256").update(`${metadata.workspaceId}:${metadata.executionId}:${path.basename(file)}`).digest("hex");const destination=path.join(directory,`${digest}${path.extname(file)}`);await copyFile(file,destination);return`artifact://${metadata.workspaceId}/${metadata.executionId}/${path.basename(destination)}`;}};
const worker=new ManagedBrowserWorker(undefined,scanner,sink),reader=createInterface({input:process.stdin,crlfDelay:Infinity});
reader.on("line",async line=>{try{const input=JSON.parse(line) as BrowserExecution;const result=await worker.execute(input);process.stdout.write(`${JSON.stringify({ok:true,result})}\n`);}catch(error){process.stdout.write(`${JSON.stringify({ok:false,error:error instanceof Error?error.message:String(error)})}\n`);}});
