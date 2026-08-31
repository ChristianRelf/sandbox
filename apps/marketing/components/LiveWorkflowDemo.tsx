"use client";

import { useMemo, useState } from "react";
import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  Bell,
  Clock3,
  GitBranch,
  GitCompare,
  Globe2,
  Navigation,
  RotateCcw,
  ScanSearch,
} from "lucide-react";
import { ProductWorkflowNode, type ProductNodeStatus } from "@sandbox/product-ui";
import styles from "./LiveWorkflowDemo.module.css";

type DemoNodeData = Record<string, unknown> & {
  name: string;
  summary: string;
  icon: typeof Clock3;
  trigger?: boolean;
  condition?: boolean;
  inputCount: number;
  outputLabels: string[];
  configuration: Record<string, unknown>;
  status?: ProductNodeStatus;
};

type DemoNode = Node<DemoNodeData, "workflow">;

const workflowNodes: DemoNode[] = [
  {
    id: "schedule",
    type: "workflow",
    position: { x: 60, y: 220 },
    data: {
      name: "Every 30 minutes",
      summary: "Every 30 minutes",
      icon: Clock3,
      trigger: true,
      inputCount: 0,
      outputLabels: ["Schedule event"],
      configuration: { scheduleType: "minutes", every: 30 },
    },
  },
  {
    id: "browser",
    type: "workflow",
    position: { x: 340, y: 220 },
    data: {
      name: "Open monitored browser",
      summary: "Choose a browser profile",
      icon: Globe2,
      inputCount: 0,
      outputLabels: ["Result"],
      configuration: { headed: false, viewport: "1280 × 800", closeAutomatically: true },
    },
  },
  {
    id: "navigate",
    type: "workflow",
    position: { x: 620, y: 220 },
    data: {
      name: "Open monitored page",
      summary: "https://example.com",
      icon: Navigation,
      inputCount: 0,
      outputLabels: ["Result"],
      configuration: { url: "https://example.com", waitCondition: "dom_ready" },
    },
  },
  {
    id: "extract",
    type: "workflow",
    position: { x: 900, y: 220 },
    data: {
      name: "Extract page heading",
      summary: "heading · text",
      icon: ScanSearch,
      inputCount: 0,
      outputLabels: ["Extracted value"],
      configuration: { locator: "role=heading[name='Example Domain']", fieldName: "heading", extract: "text" },
    },
  },
  {
    id: "compare",
    type: "workflow",
    position: { x: 1180, y: 220 },
    data: {
      name: "Compare with previous heading",
      summary: "Compare website-heading",
      icon: GitCompare,
      inputCount: 2,
      outputLabels: ["Changed", "Previous", "Current"],
      configuration: { key: "website-heading", value: "{{nodes.extract.output.data.heading}}", normalization: "collapse_whitespace" },
    },
  },
  {
    id: "condition",
    type: "workflow",
    position: { x: 1460, y: 220 },
    data: {
      name: "Heading changed",
      summary: "{{nodes.compare.output.changed}} · equals",
      icon: GitBranch,
      condition: true,
      inputCount: 2,
      outputLabels: ["Result"],
      configuration: { left: "{{nodes.compare.output.changed}}", operator: "equals", right: true },
    },
  },
  {
    id: "changed",
    type: "workflow",
    position: { x: 1740, y: 330 },
    data: {
      name: "Notify when changed",
      summary: "Website content changed",
      icon: Bell,
      inputCount: 0,
      outputLabels: ["Result"],
      configuration: { title: "Website content changed", message: "The monitored heading is now: {{nodes.extract.output.data.heading}}" },
    },
  },
];

const workflowEdges: Edge[] = [
  ["e1", "schedule", "output", "browser"],
  ["e2", "browser", "output", "navigate"],
  ["e3", "navigate", "output", "extract"],
  ["e4", "extract", "output", "compare"],
  ["e5", "compare", "output", "condition"],
  ["e6", "condition", "true", "changed"],
].map(([id, source, sourceHandle, target]) => ({
  id,
  source,
  sourceHandle,
  target,
  targetHandle: "input",
  markerEnd: { type: MarkerType.ArrowClosed, color: "#555b55", width: 14, height: 14 },
}));

function DemoWorkflowNode({ id, data, selected }: NodeProps<DemoNode>) {
  return (
    <ProductWorkflowNode
      id={id}
      name={data.name}
      summary={data.summary}
      icon={data.icon}
      status={data.status}
      selected={selected}
      trigger={data.trigger}
      condition={data.condition}
      inputCount={data.inputCount}
      outputLabels={data.outputLabels}
    />
  );
}

const nodeTypes = { workflow: DemoWorkflowNode };

export function LiveWorkflowDemo() {
  const [selectedId, setSelectedId] = useState("compare");
  const [instance, setInstance] = useState<ReactFlowInstance<DemoNode, Edge> | null>(null);
  const nodes = useMemo(
    () => workflowNodes.map((node) => ({ ...node, selected: node.id === selectedId })),
    [selectedId],
  );
  const selected = workflowNodes.find((node) => node.id === selectedId) ?? workflowNodes[0];

  return (
    <div className={styles.demo}>
      <header className={styles.toolbar}>
        <div>
          <span aria-hidden="true" />
          <strong>Website Change Monitor</strong>
          <small>Built-in template</small>
        </div>
        <button type="button" onClick={() => instance?.fitView({ padding: 0.16, duration: 320 })}>
          <RotateCcw aria-hidden="true" size={13} /> Reset view
        </button>
      </header>

      <div className={styles.desktopCanvas} aria-label="Interactive Sandbox workflow editor demonstration">
        <ReactFlow<DemoNode, Edge>
          nodes={nodes}
          edges={workflowEdges}
          nodeTypes={nodeTypes}
          onInit={setInstance}
          onNodeClick={(_, node) => setSelectedId(node.id)}
          onPaneClick={() => setSelectedId("")}
          fitView
          fitViewOptions={{ padding: 0.16 }}
          minZoom={0.45}
          maxZoom={1.3}
          nodesConnectable={false}
          elementsSelectable
        >
          <Background color="#242824" gap={22} size={1} />
          <Controls showInteractive={false} />
          <MiniMap
            nodeColor={(node) => node.id === selectedId ? "#d6ff4b" : "#3a403a"}
            maskColor="rgba(7, 9, 8, 0.72)"
          />
        </ReactFlow>
      </div>

      <div className={styles.mobileCanvas} aria-label="Website Change Monitor workflow steps">
        {workflowNodes.map((node) => (
          <button type="button" onClick={() => setSelectedId(node.id)} key={node.id}>
            <ProductWorkflowNode
              id={node.id}
              name={node.data.name}
              summary={node.data.summary}
              icon={node.data.icon}
              status={node.data.status}
              selected={node.id === selectedId}
              trigger={node.data.trigger}
              condition={node.data.condition}
              inputCount={node.data.inputCount}
              outputLabels={node.data.outputLabels}
              standalone
            />
          </button>
        ))}
      </div>

      <aside className={styles.inspector} aria-live="polite">
        <header>
          <span>Selected step</span>
          <strong>{selected.data.name}</strong>
        </header>
        <dl>
          {Object.entries(selected.data.configuration).map(([label, value]) => (
            <div key={label}>
              <dt>{label.replaceAll(/([A-Z])/g, " $1")}</dt>
              <dd>{typeof value === "string" ? value : JSON.stringify(value)}</dd>
            </div>
          ))}
        </dl>
      </aside>
    </div>
  );
}
