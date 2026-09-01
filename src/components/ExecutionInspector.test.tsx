import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExecutionRecord, Workflow } from "../types";
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
});
