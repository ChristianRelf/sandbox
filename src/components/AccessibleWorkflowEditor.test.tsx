import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Workflow } from "../types";
import { AccessibleWorkflowEditor } from "./AccessibleWorkflowEditor";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const workflow: Workflow = {
  id: "workflow-1",
  schemaVersion: 1,
  name: "Accessible workflow",
  description: "",
  enabled: true,
  triggerNodeId: "trigger",
  nodes: [
    { id: "trigger", type: "manual_trigger", version: 1, name: "Start", position: { x: 20, y: 40 }, configuration: {}, disabled: false },
    { id: "condition", type: "condition", version: 1, name: "Check result", position: { x: 300, y: 40 }, configuration: {}, disabled: false },
    { id: "notify", type: "desktop_notification", version: 1, name: "Notify", position: { x: 580, y: 40 }, configuration: {}, disabled: false },
  ],
  edges: [],
  settings: {
    defaultNodeTimeoutMs: 30000,
    maxConcurrentNodes: 1,
    permissions: { approvedFolders: [], approvedNetworkDomains: [], commandExecutionPermitted: false, backgroundExecutionPermitted: false, approvedBrowserProfileIds: [], browserAutomationPermitted: false, externalCommunicationPermitted: false },
  },
  createdAt: "2026-08-28T00:00:00.000Z",
  updatedAt: "2026-08-28T00:00:00.000Z",
};

describe("AccessibleWorkflowEditor", () => {
  it("exposes node positioning through labelled buttons", () => {
    const onChange = vi.fn();
    render(<AccessibleWorkflowEditor workflow={workflow} onChange={onChange} onSelect={vi.fn()} onAddNode={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Move Check result right" }));

    const [next, announcement] = onChange.mock.calls[0];
    expect(next.nodes.find((node: { id: string }) => node.id === "condition").position).toEqual({ x: 320, y: 40 });
    expect(announcement).toBe("Check result moved right 20 pixels.");
  });

  it("creates condition branches without drag gestures and excludes triggers as targets", async () => {
    vi.stubGlobal("crypto", { randomUUID: () => "12345678-0000-0000-0000-000000000000" });
    const onChange = vi.fn();
    render(<AccessibleWorkflowEditor workflow={workflow} onChange={onChange} onSelect={vi.fn()} onAddNode={vi.fn()} />);

    fireEvent.keyDown(screen.getByLabelText("From"), { key: "ArrowDown" });
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "Check result" }));
    await waitFor(() => expect(screen.getByLabelText("Branch")).toBeInTheDocument());
    fireEvent.keyDown(screen.getByLabelText("Branch"), { key: "ArrowDown" });
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "False" }));
    fireEvent.keyDown(screen.getByLabelText("To"), { key: "ArrowDown" });
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "Notify" }));
    expect(screen.getByLabelText("To")).not.toHaveTextContent("Start");
    fireEvent.click(screen.getByRole("button", { name: "Add connection" }));

    const [next, announcement] = onChange.mock.calls[0];
    expect(next.edges[0]).toMatchObject({ sourceNodeId: "condition", sourceHandle: "false", targetNodeId: "notify", targetHandle: "input" });
    expect(announcement).toContain("false branch");
  });
});
