import { useEffect, useState } from "react";
import { isTrigger } from "../catalogue";
import type { Workflow } from "../types";

const STEP = 20;

export function AccessibleWorkflowEditor({ workflow, selectedNodeId, onChange, onSelect, onAddNode }: {
  workflow: Workflow;
  selectedNodeId?: string;
  onChange: (workflow: Workflow, announcement: string) => void;
  onSelect: (nodeId: string) => void;
  onAddNode: () => void;
}) {
  const [sourceId, setSourceId] = useState(workflow.nodes[0]?.id ?? "");
  const [targetId, setTargetId] = useState("");
  const [sourceHandle, setSourceHandle] = useState("output");
  const source = workflow.nodes.find(node => node.id === sourceId);
  const targets = workflow.nodes.filter(node => node.id !== sourceId && !isTrigger(node.type));

  useEffect(() => {
    if (!workflow.nodes.some(node => node.id === sourceId)) setSourceId(workflow.nodes[0]?.id ?? "");
  }, [sourceId, workflow.nodes]);

  useEffect(() => {
    if (!targets.some(node => node.id === targetId)) setTargetId(targets[0]?.id ?? "");
  }, [targetId, targets]);

  useEffect(() => {
    setSourceHandle(source?.type === "condition" ? "true" : "output");
  }, [source?.type, sourceId]);

  const move = (nodeId: string, dx: number, dy: number, direction: string) => {
    const node = workflow.nodes.find(candidate => candidate.id === nodeId);
    if (!node) return;
    onChange({ ...workflow, nodes: workflow.nodes.map(candidate => candidate.id === nodeId
      ? { ...candidate, position: { x: candidate.position.x + dx, y: candidate.position.y + dy } }
      : candidate) }, `${node.name} moved ${direction} ${STEP} pixels.`);
  };

  const connect = () => {
    if (!source || !targetId || source.id === targetId) return;
    const target = workflow.nodes.find(node => node.id === targetId);
    if (!target || isTrigger(target.type)) return;
    const exists = workflow.edges.some(edge => edge.sourceNodeId === source.id && edge.targetNodeId === targetId && edge.sourceHandle === sourceHandle);
    if (exists) {
      onChange(workflow, `${source.name} is already connected to ${target.name} from ${sourceHandle}.`);
      return;
    }
    onChange({ ...workflow, edges: [...workflow.edges, {
      id: `edge_${crypto.randomUUID().slice(0, 8)}`,
      sourceNodeId: source.id,
      sourceHandle,
      targetNodeId: targetId,
      targetHandle: "input",
    }] }, `Connected ${source.name} to ${target.name}${source.type === "condition" ? ` on the ${sourceHandle} branch` : ""}.`);
  };

  return <aside className="accessible-workflow-editor" id="accessible-workflow-editor" aria-labelledby="accessible-editor-title" tabIndex={-1}>
    <header><div><h2 id="accessible-editor-title">Accessible graph editor</h2><p>Move, connect, inspect, and remove connections without dragging.</p></div><button className="button" onClick={onAddNode}>Add node</button></header>
    <section aria-labelledby="accessible-nodes-title">
      <h3 id="accessible-nodes-title">Nodes</h3>
      <ol className="accessible-node-list">
        {workflow.nodes.map(node => <li key={node.id} className={selectedNodeId === node.id ? "selected" : ""}>
          <button className="accessible-node-select" aria-pressed={selectedNodeId === node.id} onClick={() => onSelect(node.id)}><b>{node.name}</b><span>{node.type.replaceAll("_", " ")} · x {Math.round(node.position.x)}, y {Math.round(node.position.y)}</span></button>
          <div className="accessible-move-controls" aria-label={`Move ${node.name}`}>
            <button onClick={() => move(node.id, 0, -STEP, "up")} aria-label={`Move ${node.name} up`}>↑</button>
            <button onClick={() => move(node.id, -STEP, 0, "left")} aria-label={`Move ${node.name} left`}>←</button>
            <button onClick={() => move(node.id, STEP, 0, "right")} aria-label={`Move ${node.name} right`}>→</button>
            <button onClick={() => move(node.id, 0, STEP, "down")} aria-label={`Move ${node.name} down`}>↓</button>
          </div>
        </li>)}
      </ol>
    </section>
    <section aria-labelledby="accessible-connect-title">
      <h3 id="accessible-connect-title">Add connection</h3>
      <div className="accessible-connection-form">
        <label htmlFor="accessible-source">From</label><select id="accessible-source" value={sourceId} onChange={event => setSourceId(event.target.value)}>{workflow.nodes.map(node => <option value={node.id} key={node.id}>{node.name}</option>)}</select>
        {source?.type === "condition" && <><label htmlFor="accessible-branch">Branch</label><select id="accessible-branch" value={sourceHandle} onChange={event => setSourceHandle(event.target.value)}><option value="true">True</option><option value="false">False</option></select></>}
        <label htmlFor="accessible-target">To</label><select id="accessible-target" value={targetId} onChange={event => setTargetId(event.target.value)} disabled={!targets.length}>{targets.map(node => <option value={node.id} key={node.id}>{node.name}</option>)}</select>
        <button className="button primary" disabled={!source || !targetId} onClick={connect}>Add connection</button>
      </div>
    </section>
    <section aria-labelledby="accessible-connections-title">
      <h3 id="accessible-connections-title">Connections</h3>
      {workflow.edges.length === 0 ? <p className="accessible-empty">No connections.</p> : <ul className="accessible-edge-list">{workflow.edges.map(edge => {
        const from = workflow.nodes.find(node => node.id === edge.sourceNodeId)?.name ?? edge.sourceNodeId;
        const to = workflow.nodes.find(node => node.id === edge.targetNodeId)?.name ?? edge.targetNodeId;
        const description = `${from}${edge.sourceHandle === "output" ? "" : ` (${edge.sourceHandle})`} to ${to}`;
        return <li key={edge.id}><span>{description}</span><button aria-label={`Remove connection ${description}`} onClick={() => onChange({ ...workflow, edges: workflow.edges.filter(candidate => candidate.id !== edge.id) }, `Removed connection ${description}.`)}>Remove</button></li>;
      })}</ul>}
    </section>
  </aside>;
}
