import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Workflow } from "./types";
import {
  connectWorkflowNodes,
  disconnectWorkflowEdge,
  isValidWorkflowConnection,
} from "./workflowConnections";

const workflow = (): Workflow => ({
  id: "site-workflow",
  schemaVersion: 4,
  name: "Local site",
  description: "",
  enabled: true,
  triggerNodeId: "trigger",
  nodes: [
    { id: "trigger", type: "manual_trigger", version: 1, name: "Start", position: { x: 0, y: 0 }, configuration: {}, disabled: false },
    { id: "html", type: "code", version: 1, name: "HTML", position: { x: 200, y: 0 }, configuration: { language: "html", sourceCode: "<main />", executionMode: "source" }, disabled: false },
    { id: "js", type: "code", version: 1, name: "JavaScript", position: { x: 200, y: 160 }, configuration: { language: "javascript", sourceCode: "console.log('ready')", executionMode: "source" }, disabled: false },
    { id: "css", type: "code", version: 1, name: "CSS", position: { x: 200, y: 320 }, configuration: { language: "css", sourceCode: "main {}", executionMode: "source" }, disabled: false },
    { id: "site", type: "web_builder", version: 1, name: "Web Builder", position: { x: 500, y: 160 }, configuration: { html: "", javascript: "", css: "", port: 0, openBrowser: true }, disabled: false, inputBindings: {} },
  ],
  edges: [],
  settings: {
    defaultNodeTimeoutMs: 30000,
    maxConcurrentNodes: 3,
    permissions: { approvedFolders: [], approvedNetworkDomains: [], commandExecutionPermitted: false, backgroundExecutionPermitted: false, approvedBrowserProfileIds: [], browserAutomationPermitted: false, externalCommunicationPermitted: false },
  },
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
});

describe("Web Builder graph inputs", () => {
  beforeEach(() => {
    vi.stubGlobal("crypto", { randomUUID: () => "12345678-0000-0000-0000-000000000000" });
  });

  it("accepts only the matching Code language for each named input", () => {
    const current = workflow();
    expect(isValidWorkflowConnection(current, { source: "html", target: "site", sourceHandle: "output", targetHandle: "html" })).toBe(true);
    expect(isValidWorkflowConnection(current, { source: "js", target: "site", sourceHandle: "output", targetHandle: "html" })).toBe(false);
    expect(isValidWorkflowConnection(current, { source: "trigger", target: "site", sourceHandle: "output", targetHandle: "html" })).toBe(false);
  });

  it("creates the visual dependency edge and code output binding together", () => {
    const next = connectWorkflowNodes(workflow(), { source: "js", target: "site", sourceHandle: "output", targetHandle: "javascript" })!;
    expect(next.edges[0]).toMatchObject({
      sourceNodeId: "js",
      targetNodeId: "site",
      targetHandle: "javascript",
      sourcePort: "code",
      targetPort: "javascript",
    });
    expect(next.nodes.find((node) => node.id === "site")?.inputBindings?.javascript).toEqual({
      kind: "node_output",
      nodeId: "js",
      path: ["code"],
    });
  });

  it("clears the generated binding when its visual connection is removed", () => {
    const connected = connectWorkflowNodes(workflow(), { source: "css", target: "site", sourceHandle: "output", targetHandle: "css" })!;
    const disconnected = disconnectWorkflowEdge(connected, connected.edges[0].id);
    expect(disconnected.edges).toHaveLength(0);
    expect(disconnected.nodes.find((node) => node.id === "site")?.inputBindings?.css).toBeUndefined();
  });
});

