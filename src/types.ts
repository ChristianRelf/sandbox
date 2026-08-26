export type NodeType =
  | "manual_trigger" | "schedule_trigger" | "file_watch_trigger" | "condition" | "set_data" | "delay"
  | "http_request" | "desktop_notification" | "move_file" | "run_command"
  | "open_browser" | "navigate" | "click_element" | "fill_field" | "select_option" | "press_key"
  | "wait_for" | "extract_data" | "screenshot" | "download_file" | "upload_file" | "close_browser"
  | "gmail_new_email_trigger" | "gmail_get_email" | "gmail_create_draft" | "gmail_send_email" | "gmail_add_label"
  | "discord_webhook" | "discord_embed" | "slack_webhook" | "approval";
export type NodeStatus = "idle" | "waiting" | "running" | "successful" | "failed" | "skipped" | "cancelled";
export type ExecutionStatus = "queued" | "running" | "successful" | "failed" | "skipped" | "cancelled";
export interface Position { x:number; y:number }
export interface PluginNodePin { pluginId:string; pluginVersion:string; packageIntegrity:string; publisherId:string }
export interface WorkflowOwner { ownerType:"personal"|"workspace"; ownerId:string }
export interface WorkflowNode { id:string; type:NodeType; version:number; name:string; position:Position; configuration:Record<string,unknown>; disabled:boolean; plugin?:PluginNodePin }
export interface WorkflowEdge { id:string; sourceNodeId:string; sourceHandle:string; targetNodeId:string; targetHandle:string }
export interface PermissionSummary { approvedFolders:string[]; approvedNetworkDomains:string[]; commandExecutionPermitted:boolean; backgroundExecutionPermitted:boolean; approvalRevision?:string|null; approvedBrowserProfileIds:string[]; browserAutomationPermitted:boolean; externalCommunicationPermitted:boolean; communicationApprovalRevision?:string|null }
export interface WorkflowSettings { defaultNodeTimeoutMs:number; maxConcurrentNodes:number; permissions:PermissionSummary }
export interface Workflow { id:string; schemaVersion:number; owner?:WorkflowOwner; name:string; description:string; enabled:boolean; triggerNodeId:string; nodes:WorkflowNode[]; edges:WorkflowEdge[]; settings:WorkflowSettings; createdAt:string; updatedAt:string }
export interface ExecutionError { code:string; message:string; detail?:string; suggestion?:string }
export interface LocatorCandidate { kind:"role"|"label"|"placeholder"|"test_id"|"text"|"attribute"|"css"|"xpath"; value:string; name?:string; exact?:boolean }
export interface StructuredLocator { primary:LocatorCandidate; alternatives:LocatorCandidate[]; elementRole?:string; accessibleName?:string; tag:string; stableAttributes:Record<string,string>; framePath:string[]; recordingUrl:string; nearbyText?:string }
export interface BrowserDiagnostics { currentUrl:string; pageTitle:string; locatorAttempts:Array<{kind:string;value:string;matchCount:number;succeeded:boolean;weakFallback:boolean;error?:string}>; successfulLocator?:LocatorCandidate; matchCount:number; consoleErrors:string[]; failedNetworkRequests:string[]; screenshotPath?:string; tracePath?:string; playwrightError?:string; unexpectedNavigation:boolean; rerecordAvailable:boolean }
export interface NodeExecution { nodeId:string; status:NodeStatus; startedAt?:string; completedAt?:string; durationMs?:number; input:unknown; output:unknown; logs:string[]; retryCount:number; error?:ExecutionError; skipReason?:string; branchFollowed?:string; browserDiagnostics?:BrowserDiagnostics }
export interface ExecutionRecord { id:string; workflowId:string; workflowVersion:number; trigger:unknown; status:ExecutionStatus; startedAt:string; completedAt?:string; durationMs?:number; nodeExecutions:NodeExecution[]; error?:ExecutionError; skipReason?:string; recoveredAfterCrash:boolean }
export interface WorkflowSummary { workflow:Workflow; lastExecution?:ExecutionRecord; nextRunAt?:string }
export interface ValidationIssue { code:string; message:string; nodeId?:string; edgeId?:string }
export interface RunnerStatus { paused:boolean; activeWorkflowIds:string[]; localSchedulesStopOnQuit:boolean }
export interface AccountMetadata { accountId:string; email:string; displayName:string; sessionId:string; expiresAt:string; signedInAt:string }
export interface AccountStatus { configured:boolean; signedIn:boolean; metadata?:AccountMetadata; localWorkflowsAvailable:boolean; configurationError?:string }
export interface BrowserProfileSettings { viewportWidth:number; viewportHeight:number; downloadFolder?:string; proxy?:string; userAgent?:string; permissions:string[] }
export interface BrowserProfile { id:string; name:string; persistent:boolean; dataPath:string; settings:BrowserProfileSettings; createdAt:string; lastUsedAt?:string }
export interface BrowserEngineStatus { available:boolean; protocolVersion:number; sidecarVersion?:string; browserName?:string; browserVersion?:string; error?:string }
export type ConnectionStatus="connected"|"expired"|"revoked"|"error"|"setup_required";
export interface ConnectionMetadata { id:string; provider:string; displayName:string; accountIdentifier?:string; scopes:string[]; createdAt:string; lastUsedAt?:string; expiresAt?:string; status:ConnectionStatus; metadata:Record<string,unknown> }
export interface PendingApproval { id:string; executionId:string; workflowId:string; nodeId:string; action:Record<string,unknown>; status:string; createdAt:string; expiresAt:string; resolvedAt?:string }
export interface RecordedStep { id:string; action:string; name:string; configuration:Record<string,unknown>; sensitiveInputRequired:boolean }
export type PluginInstallState="disabled"|"enabled"|"revoked";
export interface InstalledPlugin { pluginId:string; version:string; packageIntegrity:string; publisherId:string; publisherKeyId:string; ownerType:"personal"|"workspace"; ownerId:string; source:"marketplace"|"private"|"development"; development:boolean; state:PluginInstallState; manifest:PluginManifest; requestedPermissions:string[]; approvedPermissions:string[]; updateRequiresReview:boolean; packagePath:string; installedAt:string; updatedAt:string }
export interface PluginManifest { pluginId:string; name:string; description:string; version:string; publisherId:string; nodes:Array<{nodeType:string;nodeVersion:number;displayName:string;description:string;category:string;riskLevel:string}>; networkDomains:Array<{domain:string;methods:string[]}>; pricing:{model:string}; [key:string]:unknown }
export interface PluginPackageInspection { inspectionId:string; manifest:PluginManifest; requestedPermissions:string[]; permissionExpansion:string[]; expiresAt:string; development:boolean; signedAndVerified:boolean }
export interface PackageTrustMetadata { publisherId:string; keyId:string; publisherPublicKeyPem:string; ownerType:"personal"|"workspace"; ownerId:string; source:"marketplace"|"private"|"development" }
