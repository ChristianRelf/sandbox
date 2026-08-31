import type { NodeProps } from "@xyflow/react";
import { ProductWorkflowNode } from "@sandbox/product-ui";
import { definitionFor } from "../catalogue";
import type { NodeStatus, WorkflowNode } from "../types";

export interface WorkflowNodeData extends Record<string, unknown> {
  node: WorkflowNode;
  status: NodeStatus;
  warning?: string;
  onAdd: (sourceId: string) => void;
}

export function WorkflowNodeCard({ data, selected }: NodeProps) {
  const { node, status, warning, onAdd } = data as WorkflowNodeData;
  const definition = definitionFor(node.type);

  return (
    <ProductWorkflowNode
      id={node.id}
      name={node.name}
      summary={definition.summary(node.configuration)}
      icon={definition.icon}
      status={status}
      selected={selected}
      disabled={node.disabled}
      warning={warning}
      trigger={
        node.type === "manual_trigger" ||
        node.type === "schedule_trigger" ||
        node.type === "file_watch_trigger" ||
        node.type === "gmail_new_email_trigger"
      }
      condition={node.type === "condition"}
      inputCount={definition.inputs.length}
      outputLabels={definition.outputs.map((port) => port.label)}
      onAdd={onAdd}
    />
  );
}
