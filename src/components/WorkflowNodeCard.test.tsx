import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkflowNode } from "../types";
import { NodeAskAiAction } from "./WorkflowNodeCard";

const node: WorkflowNode = {
  id: "request",
  type: "http_request",
  version: 1,
  name: "Fetch status",
  position: { x: 80, y: 120 },
  configuration: { url: "https://example.com" },
  disabled: false,
};

describe("NodeAskAiAction", () => {
  afterEach(cleanup);

  it("appears for a selected node and passes the node context", () => {
    const onAsk = vi.fn();
    render(
      <NodeAskAiAction
        node={node}
        selected
        showOnInteraction
        showOnIssues={false}
        onAsk={onAsk}
      />,
    );

    const action = screen.getByRole("button", { name: "Ask AI about Fetch status" });
    expect(action).toHaveClass("node-ask-ai-selected");
    fireEvent.click(action);
    expect(onAsk).toHaveBeenCalledWith(node, undefined);
  });

  it("stays available for an issue when the issue preference is enabled", () => {
    const onAsk = vi.fn();
    render(
      <NodeAskAiAction
        node={node}
        issue="Network access is not approved."
        selected={false}
        showOnInteraction={false}
        showOnIssues
        onAsk={onAsk}
      />,
    );

    const action = screen.getByRole("button", {
      name: "Ask AI about the issue on Fetch status",
    });
    expect(action).toHaveClass("node-ask-ai-issue");
    fireEvent.click(action);
    expect(onAsk).toHaveBeenCalledWith(node, "Network access is not approved.");
  });

  it("does not render when both preferences are disabled", () => {
    render(
      <NodeAskAiAction
        node={node}
        issue="Network access is not approved."
        selected
        showOnInteraction={false}
        showOnIssues={false}
        onAsk={vi.fn()}
      />,
    );

    expect(screen.queryByText("Ask AI")).not.toBeInTheDocument();
  });
});
