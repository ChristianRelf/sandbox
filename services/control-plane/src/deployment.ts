import { checkRunnerCompatibility, type DeploymentStatus, type DeploymentValidationIssue, type ExecutionTarget, type RunnerIdentity, type RunnerRequirements, type UsageEstimate } from "@sandbox/contracts";
import { DomainError } from "./types.js";

export interface DeploymentNode {
  nodeId: string;
  nodeType: string;
  nodeVersion: number;
  plugin: { pluginId:string; version:string; packageIntegrity:string } | null;
  requiresBrowser: boolean;
  requiresLocalFile: boolean;
  localFileLabel: string | null;
  requiredConnectionIds: string[];
  requiredEnvironmentVariables: string[];
  networkTargets: string[];
  approvalRequired: boolean;
}

export interface DeploymentValidationInput {
  target: ExecutionTarget;
  region: string;
  requirements: RunnerRequirements;
  nodes: DeploymentNode[];
  graphIssues: Array<{ code:string; message:string; nodeId:string|null }>;
  availableRunners: RunnerIdentity[];
  availableConnectionIds: string[];
  availableEnvironmentVariables: string[];
  approvedNetworkTargets: string[];
  approvedPluginPackages: Array<{ pluginId:string; version:string; packageIntegrity:string }>;
  approvalSnapshotPresent: boolean;
  concurrencyLimit: number;
  retentionDays: number;
  estimatedUsage: UsageEstimate;
}

export interface DeploymentValidationResult {
  valid: boolean;
  issues: DeploymentValidationIssue[];
  compatibleRunnerIds: string[];
  dataLeavingLocalMachine: string[];
  unavailableLocalFiles: string[];
  estimatedUsage: UsageEstimate;
}

const localTargets = new Set<ExecutionTarget>(["this_computer","paired_desktop","self_hosted_server","nas_or_raspberry_pi"]);

export function validateDeployment(input: DeploymentValidationInput): DeploymentValidationResult {
  const issues:DeploymentValidationIssue[]=[];
  const add=(code:string,severity:DeploymentValidationIssue["severity"],message:string,nodeId:string|null=null,resourceId:string|null=null)=>issues.push({code,severity,message,nodeId,resourceId});
  for(const issue of input.graphIssues) add(`graph_${issue.code}`,"error",issue.message,issue.nodeId);
  const browserNodes=input.nodes.filter(node=>node.requiresBrowser);
  if(browserNodes.length && input.target!=="managed_browser_worker") for(const node of browserNodes) add("browser_target_required","error","Browser node requires a managed browser worker or compatible browser-capable local runner.",node.nodeId);
  if(!browserNodes.length && input.target==="managed_browser_worker") add("browser_target_unnecessary","warning","No browser node requires a managed browser worker.");
  const unavailableLocalFiles=input.nodes.filter(node=>node.requiresLocalFile && !localTargets.has(input.target)).map(node=>node.localFileLabel??node.nodeId);
  for(const node of input.nodes.filter(node=>node.requiresLocalFile && !localTargets.has(input.target))) add("local_file_unavailable","error",`Local file '${node.localFileLabel??node.nodeId}' is unavailable on the selected runner.`,node.nodeId);
  const availableConnections=new Set(input.availableConnectionIds);
  for(const node of input.nodes) for(const id of node.requiredConnectionIds) if(!availableConnections.has(id)) add("connection_unresolved","error","Required connection is not deployed to the selected environment.",node.nodeId,id);
  const availableVariables=new Set(input.availableEnvironmentVariables);
  for(const node of input.nodes) for(const name of node.requiredEnvironmentVariables) if(!availableVariables.has(name)) add("environment_variable_missing","error",`Protected variable '${name}' is not mapped in this environment.`,node.nodeId,name);
  const approvedTargets=new Set(input.approvedNetworkTargets);
  for(const node of input.nodes) for(const target of node.networkTargets) if(!approvedTargets.has(target)) add("network_target_unapproved","error",`Network target '${target}' is not approved for this environment.`,node.nodeId,target);
  for(const node of input.nodes.filter(node=>node.plugin)) {
    const plugin=node.plugin!;
    if(!input.approvedPluginPackages.some(item=>item.pluginId===plugin.pluginId&&item.version===plugin.version&&item.packageIntegrity===plugin.packageIntegrity)) add("plugin_unavailable","error",`Exact plugin ${plugin.pluginId}@${plugin.version} is unavailable or unapproved.`,node.nodeId,plugin.pluginId);
  }
  if(input.nodes.some(node=>node.approvalRequired)&&!input.approvalSnapshotPresent) add("approval_snapshot_missing","error","The revision requires an approved permission snapshot.");
  if(!Number.isInteger(input.concurrencyLimit)||input.concurrencyLimit<1||input.concurrencyLimit>1_000) add("concurrency_invalid","error","Concurrency must be between 1 and 1000.");
  if(!Number.isInteger(input.retentionDays)||input.retentionDays<1||input.retentionDays>3650) add("retention_invalid","error","Retention must be between 1 and 3650 days.");
  const compatibleRunnerIds=input.availableRunners.filter(runner=>checkRunnerCompatibility(runner,input.requirements).compatible).map(runner=>runner.runnerId);
  if(compatibleRunnerIds.length===0) {
    add("runner_incompatible","error","No selected runner satisfies every version, capability, plugin, connection and placement requirement.");
    for(const runner of input.availableRunners) for(const reason of checkRunnerCompatibility(runner,input.requirements).reasons) add("runner_mismatch","info",reason,null,runner.runnerId);
  }
  if(!input.region.trim()) add("region_missing","error","Execution region must be explicit.");
  const dataLeavingLocalMachine=localTargets.has(input.target)?[]:["Encrypted workflow revision","Mapped trigger payload","Redacted execution metadata",...(input.nodes.some(node=>node.requiredConnectionIds.length)?["Data sent through mapped cloud connections"]:[])];
  return {valid:!issues.some(issue=>issue.severity==="error"),issues,compatibleRunnerIds,dataLeavingLocalMachine,unavailableLocalFiles,estimatedUsage:input.estimatedUsage};
}

const deploymentTransitions:Readonly<Record<DeploymentStatus,ReadonlySet<DeploymentStatus>>>={
  draft:new Set(["validating"]),validating:new Set(["awaiting_approval","deploying","failed"]),awaiting_approval:new Set(["deploying","failed"]),deploying:new Set(["active","failed"]),active:new Set(["degraded","paused","superseded","rolled_back"]),degraded:new Set(["active","paused","failed","superseded","rolled_back"]),paused:new Set(["active","superseded","rolled_back"]),failed:new Set(["validating","superseded"]),superseded:new Set(),rolled_back:new Set()
};
export function requireDeploymentTransition(from:DeploymentStatus,to:DeploymentStatus):void { if(!deploymentTransitions[from].has(to)) throw new DomainError("deployment_transition_invalid",`Deployment transition ${from} -> ${to} is not allowed.`,409); }

export interface UsageEstimateInput { periodDays:number; scheduleExecutions:number; historicLocalDurationSeconds:number|null; configuredTimeoutSeconds:number; browserRequired:boolean; maximumAttempts:number; expectedConcurrency:number }
export function estimateHostedUsage(input:UsageEstimateInput):UsageEstimate {
  const observed=input.historicLocalDurationSeconds&&input.historicLocalDurationSeconds>0?Math.min(input.historicLocalDurationSeconds,input.configuredTimeoutSeconds):input.configuredTimeoutSeconds;
  const retryMultiplier=Math.max(1,Math.min(input.maximumAttempts,100));
  const executions=Math.max(0,Math.floor(input.scheduleExecutions));
  const seconds=executions*observed*retryMultiplier;
  return {periodDays:Math.max(1,Math.min(Math.floor(input.periodDays),366)),expectedExecutions:executions,hostedExecutionSeconds:input.browserRequired?0:seconds,browserWorkerSeconds:input.browserRequired?seconds:0,expectedConcurrentExecutions:Math.max(1,Math.floor(input.expectedConcurrency)),retryMultiplier,confidence:input.historicLocalDurationSeconds?"medium":"low",basis:[`${executions} expected executions`,input.historicLocalDurationSeconds?`${input.historicLocalDurationSeconds}s historic local duration`:`${input.configuredTimeoutSeconds}s configured timeout`,`${retryMultiplier} maximum attempt multiplier`,input.browserRequired?"Managed browser required":"Non-browser hosted execution"],disclaimer:"Estimate only; actual usage and cost may differ."};
}
