export type NodeType =
  | "manual_trigger" | "schedule_trigger" | "file_watch_trigger" | "condition" | "set_data" | "delay"
  | "http_request" | "desktop_notification" | "move_file" | "run_command";
export type NodeStatus = "idle" | "waiting" | "running" | "successful" | "failed" | "skipped" | "cancelled";
export type ExecutionStatus = "queued" | "running" | "successful" | "failed" | "skipped" | "cancelled";
export interface Position { x:number; y:number }
export interface WorkflowNode { id:string; type:NodeType; version:number; name:string; position:Position; configuration:Record<string,unknown>; disabled:boolean }
export interface WorkflowEdge { id:string; sourceNodeId:string; sourceHandle:string; targetNodeId:string; targetHandle:string }
export interface PermissionSummary { approvedFolders:string[]; approvedNetworkDomains:string[]; commandExecutionPermitted:boolean; backgroundExecutionPermitted:boolean; approvalRevision?:string|null }
export interface WorkflowSettings { defaultNodeTimeoutMs:number; maxConcurrentNodes:number; permissions:PermissionSummary }
export interface Workflow { id:string; schemaVersion:number; name:string; description:string; enabled:boolean; triggerNodeId:string; nodes:WorkflowNode[]; edges:WorkflowEdge[]; settings:WorkflowSettings; createdAt:string; updatedAt:string }
export interface ExecutionError { code:string; message:string; detail?:string; suggestion?:string }
export interface NodeExecution { nodeId:string; status:NodeStatus; startedAt?:string; completedAt?:string; durationMs?:number; input:unknown; output:unknown; logs:string[]; retryCount:number; error?:ExecutionError; skipReason?:string; branchFollowed?:string }
export interface ExecutionRecord { id:string; workflowId:string; workflowVersion:number; trigger:unknown; status:ExecutionStatus; startedAt:string; completedAt?:string; durationMs?:number; nodeExecutions:NodeExecution[]; error?:ExecutionError; skipReason?:string; recoveredAfterCrash:boolean }
export interface WorkflowSummary { workflow:Workflow; lastExecution?:ExecutionRecord; nextRunAt?:string }
export interface ValidationIssue { code:string; message:string; nodeId?:string; edgeId?:string }
export interface RunnerStatus { paused:boolean; activeWorkflowIds:string[]; localSchedulesStopOnQuit:boolean }
