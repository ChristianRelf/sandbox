import { checkRunnerCompatibility, runnerIdentitySchema, runnerRequirementsSchema, type RunnerIdentity, type RunnerRequirements } from "@sandbox/contracts";

export type RunnerPoolStrategy = "least_loaded" | "round_robin" | "priority_failover";
export interface RunnerPoolPolicy {
  strategy: RunnerPoolStrategy;
  region: string | null;
  requiredTags: string[];
  maximumConcurrency: number;
  staleAfterSeconds: number;
}
export interface RunnerPoolCandidate {
  identity: RunnerIdentity;
  currentWorkload: number;
  lastSeenAt: string | null;
  online: boolean;
  enabled: boolean;
  priority: number;
}
export interface RunnerPoolSelection {
  runner: RunnerPoolCandidate | null;
  nextCursor: number;
  rejected: Array<{ runnerId: string; reasons: string[] }>;
}

export function selectRunnerFromPool(policyInput: RunnerPoolPolicy, requirementsInput: RunnerRequirements, candidatesInput: RunnerPoolCandidate[], cursor: number, now: Date): RunnerPoolSelection {
  const requirements=runnerRequirementsSchema.parse(requirementsInput),policy=validatePolicy(policyInput),rejected:RunnerPoolSelection["rejected"]=[],compatible:RunnerPoolCandidate[]=[];
  const totalWorkload=candidatesInput.filter(candidate=>candidate.enabled).reduce((total,candidate)=>total+Math.max(0,candidate.currentWorkload),0);
  for(const input of candidatesInput){const candidate={...input,identity:runnerIdentitySchema.parse(input.identity)},reasons:string[]=[];
    if(!candidate.enabled)reasons.push("Runner is disabled in this pool.");
    if(!candidate.online)reasons.push("Runner is offline.");
    const lastSeen=candidate.lastSeenAt===null?NaN:Date.parse(candidate.lastSeenAt);
    if(!Number.isFinite(lastSeen)||now.getTime()-lastSeen>policy.staleAfterSeconds*1000)reasons.push("Runner heartbeat is stale.");
    if(candidate.currentWorkload<0||candidate.identity.concurrencyLimit-candidate.currentWorkload<requirements.minimumAvailableConcurrency)reasons.push("Runner has insufficient available concurrency.");
    if(policy.region!==null&&candidate.identity.region!==policy.region)reasons.push(`Runner region ${candidate.identity.region} does not satisfy pool region ${policy.region}.`);
    for(const tag of policy.requiredTags)if(!candidate.identity.tags.includes(tag))reasons.push(`Missing pool tag ${tag}.`);
    reasons.push(...checkRunnerCompatibility(candidate.identity,requirements).reasons);
    if(reasons.length)rejected.push({runnerId:candidate.identity.runnerId,reasons:[...new Set(reasons)]});else compatible.push(candidate);
  }
  if(totalWorkload+requirements.minimumAvailableConcurrency>policy.maximumConcurrency||compatible.length===0)return{runner:null,nextCursor:cursor,rejected};
  compatible.sort((left,right)=>left.identity.runnerId.localeCompare(right.identity.runnerId));
  if(policy.strategy==="round_robin"){const index=normalizeCursor(cursor,compatible.length);return{runner:compatible[index],nextCursor:cursor+1,rejected};}
  compatible.sort((left,right)=>policy.strategy==="priority_failover"?left.priority-right.priority||loadRatio(left)-loadRatio(right)||left.identity.runnerId.localeCompare(right.identity.runnerId):loadRatio(left)-loadRatio(right)||left.priority-right.priority||left.identity.runnerId.localeCompare(right.identity.runnerId));
  return{runner:compatible[0],nextCursor:cursor,rejected};
}

function validatePolicy(policy:RunnerPoolPolicy):RunnerPoolPolicy{if(!Number.isInteger(policy.maximumConcurrency)||policy.maximumConcurrency<1||policy.maximumConcurrency>10000)throw new Error("Pool maximum concurrency must be between 1 and 10000.");if(!Number.isInteger(policy.staleAfterSeconds)||policy.staleAfterSeconds<15||policy.staleAfterSeconds>3600)throw new Error("Pool heartbeat staleness must be between 15 and 3600 seconds.");if(policy.requiredTags.length>50)throw new Error("Pool cannot require more than 50 tags.");return policy;}
function loadRatio(candidate:RunnerPoolCandidate){return candidate.currentWorkload/candidate.identity.concurrencyLimit;}
function normalizeCursor(cursor:number,length:number){const integer=Number.isSafeInteger(cursor)?cursor:0;return((integer%length)+length)%length;}
