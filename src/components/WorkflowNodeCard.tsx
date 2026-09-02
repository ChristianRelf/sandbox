import type { NodeProps } from "@xyflow/react";
import { ProductWorkflowNode } from "@sandbox/product-ui";
import { Sparkles } from "lucide-react";
import { definitionFor, isTrigger } from "../catalogue";
import type { NodeStatus, WorkflowNode } from "../types";
import { WEB_BUILDER_INPUT_PORTS } from "../workflowConnections";

export interface WorkflowNodeData extends Record<string, unknown> {
  node: WorkflowNode;
  status: NodeStatus;
  warning?: string;
  askAiIssue?: string;
  showAskAiOnInteraction: boolean;
  showAskAiOnIssues: boolean;
  onAskAi: (node: WorkflowNode, issue?: string) => void;
  onAdd: (sourceId: string) => void;
  connectionRole?: "input" | "output" | "both";
  dimmed?: boolean;
}

export function WorkflowNodeCard({ data, selected }: NodeProps) {
  const {
    node,
    status,
    warning,
    askAiIssue,
    showAskAiOnInteraction,
    showAskAiOnIssues,
    onAskAi,
    onAdd,
    connectionRole,
    dimmed,
  } = data as WorkflowNodeData;
  const definition = definitionFor(node.type);

  return (
    <>
      <ProductWorkflowNode
        id={node.id}
        name={node.name}
        summary={definition.summary(node.configuration)}
        icon={definition.icon}
        status={status}
        selected={selected}
        disabled={node.disabled}
        warning={warning}
        trigger={isTrigger(node.type)}
        condition={node.type === "condition"}
        inputCount={definition.inputs.length}
        inputPorts={node.type === "web_builder" ? [...WEB_BUILDER_INPUT_PORTS] : undefined}
        outputLabels={definition.outputs.map((port) => port.label)}
        onAdd={onAdd}
        connectionRole={connectionRole}
        dimmed={dimmed}
      />
      <NodeAskAiAction
        node={node}
        issue={askAiIssue}
        selected={selected}
        showOnInteraction={showAskAiOnInteraction}
        showOnIssues={showAskAiOnIssues}
        onAsk={onAskAi}
      />
    </>
  );
}

export function NodeAskAiAction({
  node,
  issue,
  selected,
  showOnInteraction,
  showOnIssues,
  onAsk,
}: {
  node: WorkflowNode;
  issue?: string;
  selected: boolean;
  showOnInteraction: boolean;
  showOnIssues: boolean;
  onAsk: (node: WorkflowNode, issue?: string) => void;
}) {
  const issueVisible = Boolean(issue && showOnIssues);
  if (!showOnInteraction && !issueVisible) return null;

  return (
    <button
      type="button"
      className={`node-ask-ai nodrag nopan ${selected && showOnInteraction ? "node-ask-ai-selected" : ""} ${issueVisible ? "node-ask-ai-issue" : ""}`}
      aria-label={
        issueVisible ? `Ask AI about the issue on ${node.name}` : `Ask AI about ${node.name}`
      }
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        onAsk(node, issue);
      }}
    >
      <Sparkles aria-hidden="true" size={12} />
      <span>Ask AI</span>
    </button>
  );
}
