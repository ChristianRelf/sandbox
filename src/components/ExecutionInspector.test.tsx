import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExecutionRecord, Workflow, WorkflowItem } from "../types";
import { ExecutionInspector } from "./ExecutionInspector";

const permissionError = {
  code: "permission_required",
  message: "Run Command requires approval before it can run in the background.",
  suggestion: "Review and approve the workflow permissions.",
};

const workflow: Workflow = {
  id: "workflow-permission",
  schemaVersion: 1,
  name: "Permission workflow",
  description: "",
  enabled: true,
  triggerNodeId: "trigger",
  nodes: [
    {
      id: "trigger",
      type: "manual_trigger",
      version: 1,
      name: "Manual Trigger",
      position: { x: 0, y: 0 },
      configuration: {},
      disabled: false,
    },
    {
      id: "command",
      type: "run_command",
      version: 1,
      name: "Run report",
      position: { x: 250, y: 0 },
      configuration: { executable: "report.exe", arguments: [] },
      disabled: false,
    },
  ],
  edges: [],
  settings: {
    defaultNodeTimeoutMs: 30000,
    maxConcurrentNodes: 1,
    permissions: {
      approvedFolders: [],
      approvedNetworkDomains: [],
      approvedBrowserProfileIds: [],
      commandExecutionPermitted: false,
      backgroundExecutionPermitted: false,
      browserAutomationPermitted: false,
      externalCommunicationPermitted: false,
    },
  },
  createdAt: "2026-09-01T10:00:00.000Z",
  updatedAt: "2026-09-01T10:00:00.000Z",
};

const run: ExecutionRecord = {
  id: "run-permission",
  workflowId: workflow.id,
  workflowVersion: 1,
  trigger: { type: "manual" },
  status: "failed",
  startedAt: "2026-09-01T10:00:00.000Z",
  completedAt: "2026-09-01T10:00:00.100Z",
  durationMs: 100,
  nodeExecutions: [
    {
      nodeId: "command",
      status: "failed",
      input: {},
      output: {},
      logs: [],
      retryCount: 0,
      error: permissionError,
    },
  ],
  error: permissionError,
  recoveredAfterCrash: false,
};

describe("ExecutionInspector permission recovery", () => {
  afterEach(cleanup);

  it("opens permission review for the node that paused the run", () => {
    const onReviewPermissions = vi.fn();
    render(
      <ExecutionInspector
        run={run}
        workflow={workflow}
        onRetry={vi.fn()}
        onReviewPermissions={onReviewPermissions}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: /permission required/i }),
    );

    expect(onReviewPermissions).toHaveBeenCalledWith({
      nodeId: "command",
      message: permissionError.message,
    });
  });

  it("shows bounded collection counts and rejected item lineage", () => {
    const item:WorkflowItem={itemId:"source:1",originItemId:"source:1",data:{email:"duplicate@example.com"},executionAttempt:1,status:"removed"};
    const collectionRun:ExecutionRecord={...run,status:"successful",error:undefined,nodeExecutions:[{...run.nodeExecutions[0],status:"successful",error:undefined,inputItems:[item],outputItems:[],collection:{inputItemCount:2,outputItemCount:1,rejectedItemCount:1,branchCounts:{output:1,duplicates:1},iterationCount:0,batchCount:0,sampleItems:[item],previewTruncated:true,runtimeDataTruncated:false,orderingPolicy:"input_order",waitingForInputs:[]}}]};
    render(<ExecutionInspector run={collectionRun} workflow={workflow} onRetry={vi.fn()}/>);
    expect(screen.getByText("Removed / rejected").parentElement).toHaveTextContent("1");
    expect(screen.getByText(/bounded preview/i)).toBeInTheDocument();
    const tab=screen.getByRole("tab",{name:/Items/i});
    fireEvent.mouseDown(tab,{button:0,ctrlKey:false});
    fireEvent.click(tab);
    expect(screen.getAllByText("source:1")).toHaveLength(2);
    expect(screen.getByText(/duplicate@example.com/)).toBeInTheDocument();
  });
});
