import { invoke } from "@tauri-apps/api/core";
import type { BrowserEngineStatus, BrowserProfile, BrowserProfileSettings, ExecutionRecord, PermissionSummary, RecordedStep, RunnerStatus, StructuredLocator, ValidationIssue, Workflow, WorkflowSummary } from "./types";
import { previewApi } from "./previewApi";
const tauri=typeof window!=="undefined"&&"__TAURI_INTERNALS__" in window;
export const api={
  listWorkflows:()=>tauri?invoke<WorkflowSummary[]>("list_workflows"):previewApi.listWorkflows(),
  getWorkflow:(id:string)=>tauri?invoke<Workflow|undefined>("get_workflow",{id}):previewApi.getWorkflow(id),
  saveWorkflow:(workflow:Workflow)=>tauri?invoke<Workflow>("save_workflow",{workflow}):previewApi.saveWorkflow(workflow),
  createWorkflow:(templateKey?:string,name?:string)=>tauri?invoke<Workflow>("create_workflow",{templateKey,name}):previewApi.createWorkflow(templateKey,name),
  deleteWorkflow:(id:string)=>tauri?invoke<void>("delete_workflow",{id}):previewApi.deleteWorkflow(id),
  validateWorkflow:(workflow:Workflow)=>tauri?invoke<ValidationIssue[]>("validate_workflow",{workflow}):previewApi.validateWorkflow(workflow),
  runWorkflow:(id:string)=>tauri?invoke<ExecutionRecord>("run_workflow",{id,trigger:{type:"manual"}}):previewApi.runWorkflow(id),
  retryFailedNode:(executionId:string,nodeId:string)=>tauri?invoke<ExecutionRecord>("retry_failed_node",{executionId,nodeId}):previewApi.retryFailedNode(executionId,nodeId),
  cancelExecution:(executionId:string)=>tauri?invoke<void>("cancel_execution",{executionId}):previewApi.cancelExecution(),
  listExecutions:(workflowId?:string,limit=100)=>tauri?invoke<ExecutionRecord[]>("list_executions",{workflowId,limit}):previewApi.listExecutions(workflowId),
  getExecution:(id:string)=>tauri?invoke<ExecutionRecord|undefined>("get_execution",{id}):previewApi.getExecution(id),
  clearExecutionHistory:(keep=0)=>tauri?invoke<number>("clear_execution_history",{keep}):previewApi.clearExecutionHistory(),
  approvePermissions:(id:string,permissions:PermissionSummary)=>invoke<Workflow>("approve_permissions",{id,permissions}),
  runnerStatus:()=>tauri?invoke<RunnerStatus>("runner_status"):Promise.resolve({paused:false,activeWorkflowIds:[],localSchedulesStopOnQuit:true}),
  browserEngineStatus:()=>tauri?invoke<BrowserEngineStatus>("browser_engine_status"):Promise.resolve({available:true,protocolVersion:1,sidecarVersion:"0.2.0",browserName:"chromium",browserVersion:"140.0.7339.16"}),
  restartBrowserEngine:()=>invoke<BrowserEngineStatus>("restart_browser_engine"),
  listBrowserProfiles:()=>tauri?invoke<BrowserProfile[]>("list_browser_profiles"):previewApi.listBrowserProfiles(),
  createBrowserProfile:(name:string,persistent=true,settings?:BrowserProfileSettings)=>tauri?invoke<BrowserProfile>("create_browser_profile",{name,persistent,settings}):previewApi.createBrowserProfile(name,persistent,settings),
  updateBrowserProfile:(id:string,name:string,persistent:boolean,settings:BrowserProfileSettings)=>tauri?invoke<BrowserProfile>("update_browser_profile",{id,name,persistent,settings}):previewApi.updateBrowserProfile(id,name,persistent,settings),
  duplicateBrowserProfile:(id:string)=>tauri?invoke<BrowserProfile>("duplicate_browser_profile",{id}):previewApi.duplicateBrowserProfile(id),
  clearBrowserProfileData:(id:string)=>invoke<void>("clear_browser_profile_data",{id}),
  deleteBrowserProfile:(id:string)=>tauri?invoke<void>("delete_browser_profile",{id}):previewApi.deleteBrowserProfile(id),
  openBrowserProfile:(id:string)=>invoke<Record<string,unknown>>("open_browser_profile",{id}),
  startBrowserRecording:(profileId:string,initialUrl?:string)=>invoke<{browserSession:{sessionId:string}}>("start_browser_recording",{profileId,initialUrl}),
  getBrowserRecording:(sessionId:string)=>invoke<{steps:RecordedStep[]}>("get_browser_recording",{sessionId}),
  stopBrowserRecording:(sessionId:string)=>invoke<{steps:RecordedStep[]}>("stop_browser_recording",{sessionId}),
  testBrowserLocator:(sessionId:string,locator:StructuredLocator)=>invoke<Record<string,unknown>>("test_browser_locator",{sessionId,locator}),
  isDesktop:tauri,
};
