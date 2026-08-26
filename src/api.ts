import { invoke } from "@tauri-apps/api/core";
import type { ExecutionRecord, PermissionSummary, RunnerStatus, ValidationIssue, Workflow, WorkflowSummary } from "./types";
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
  cancelExecution:(executionId:string)=>tauri?invoke<void>("cancel_execution",{executionId}):previewApi.cancelExecution(),
  listExecutions:(workflowId?:string,limit=100)=>tauri?invoke<ExecutionRecord[]>("list_executions",{workflowId,limit}):previewApi.listExecutions(workflowId),
  getExecution:(id:string)=>tauri?invoke<ExecutionRecord|undefined>("get_execution",{id}):previewApi.getExecution(id),
  clearExecutionHistory:(keep=0)=>tauri?invoke<number>("clear_execution_history",{keep}):previewApi.clearExecutionHistory(),
  approvePermissions:(id:string,permissions:PermissionSummary)=>invoke<Workflow>("approve_permissions",{id,permissions}),
  runnerStatus:()=>tauri?invoke<RunnerStatus>("runner_status"):Promise.resolve({paused:false,activeWorkflowIds:[],localSchedulesStopOnQuit:true}),
  isDesktop:tauri,
};
