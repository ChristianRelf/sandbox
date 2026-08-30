import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";
import { defaultPreferences, usePreferences } from "../preferences";
import { useAppStore } from "../store";
import type { ExecutionRecord, Workflow, WorkflowSummary } from "../types";
import { ToastProvider } from "./ui/Toast";
import { Dashboard } from "./Dashboard";

const workflow: Workflow = {
  id: "workflow-one",
  schemaVersion: 1,
  name: "Daily report",
  description: "Downloads the daily report",
  enabled: false,
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
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-30T00:00:00.000Z",
};
const summary: WorkflowSummary = {
  workflow,
  metadata: { favorite: false, tags: [] },
};
const run: ExecutionRecord = {
  id: "run-one",
  workflowId: workflow.id,
  workflowVersion: 1,
  trigger: { type: "manual" },
  status: "successful",
  startedAt: workflow.updatedAt,
  nodeExecutions: [],
  recoveredAfterCrash: false,
};

describe("Dashboard interactions", () => {
  afterEach(cleanup);
  beforeEach(() => {
    vi.restoreAllMocks();
    usePreferences.setState({ ...defaultPreferences });
    useAppStore.setState({
      view: "workflows",
      workflows: [],
      executions: [],
      activeWorkflow: undefined,
      selectedExecution: undefined,
      loading: false,
      error: undefined,
    });
    vi.spyOn(api, "listWorkflows").mockResolvedValue([summary]);
    vi.spyOn(api, "getWorkflow").mockResolvedValue(workflow);
    vi.spyOn(api, "runWorkflow").mockResolvedValue(run);
  });

  it("opens a row on one click while nested Run stays isolated", async () => {
    render(
      <ToastProvider>
        <Dashboard />
      </ToastProvider>,
    );
    await screen.findByText("Daily report");
    fireEvent.click(screen.getByLabelText("Run Daily report"));
    expect(useAppStore.getState().view).toBe("workflows");
    fireEvent.click(document.querySelector(".workflow-row")!);
    await waitFor(() => expect(useAppStore.getState().view).toBe("editor"));
  });

  it("focuses search with slash and submits creation explicitly", async () => {
    const created = { ...workflow, id: "created", name: "Named workflow" };
    vi.spyOn(api, "createWorkflow").mockResolvedValue(created);
    render(
      <ToastProvider>
        <Dashboard />
      </ToastProvider>,
    );
    const search = await screen.findByLabelText("Search workflows");
    fireEvent.keyDown(window, { key: "/" });
    expect(search).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Create workflow" }));
    const name = screen.getByLabelText("Workflow name");
    fireEvent.change(name, { target: { value: "Named workflow" } });
    fireEvent.click(screen.getByRole("button", { name: "Create workflow" }));
    await waitFor(() =>
      expect(api.createWorkflow).toHaveBeenCalledWith(
        undefined,
        "Named workflow",
      ),
    );
  });
});
