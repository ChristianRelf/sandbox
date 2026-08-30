import { Handle, Position, type NodeProps } from "@xyflow/react";
import { AlertTriangle, Plus } from "lucide-react";
import { definitionFor } from "../catalogue";
import type { NodeStatus, WorkflowNode } from "../types";

export interface WorkflowNodeData extends Record<string,unknown>{node:WorkflowNode;status:NodeStatus;warning?:string;onAdd:(sourceId:string)=>void}
export function WorkflowNodeCard({data,selected}:NodeProps){const {node,status,warning,onAdd}=data as WorkflowNodeData;const definition=definitionFor(node.type);const Icon=definition.icon;return <div className={`node-card ${selected?"selected":""} node-${status} ${node.disabled?"disabled":""}`}>
  {node.type!=="manual_trigger"&&node.type!=="schedule_trigger"&&node.type!=="file_watch_trigger"&&<Handle type="target" position={Position.Left} id="input" className="node-handle"/>}
  <div className="node-top"><span className="node-icon"><Icon size={15}/></span><span className={`node-state state-${status}`}/>{warning&&<AlertTriangle className="node-warning" size={14}/>}</div>
  <b>{node.name}</b><small>{definition.summary(node.configuration)}</small>
  <div className="node-data-contract" aria-label={`${definition.inputs.length} typed inputs and ${definition.outputs.length} typed outputs`}>
    <span>{definition.inputs.length ? `${definition.inputs.length} in` : "trigger"}</span>
    <span>→</span>
    <span>{definition.outputs.slice(0,2).map(port=>port.label).join(", ") || "done"}</span>
  </div>
  {node.type==="condition"?<><Handle type="source" position={Position.Right} id="true" className="node-handle branch true" style={{top:"42%"}}/><Handle type="source" position={Position.Right} id="false" className="node-handle branch false" style={{top:"76%"}}/><span className="branch-label true-label">true</span><span className="branch-label false-label">false</span></>:<Handle type="source" position={Position.Right} id="output" className="node-handle"/>}
  <button className="node-add nodrag" aria-label={`Add after ${node.name}`} onClick={e=>{e.stopPropagation();onAdd(node.id)}}><Plus size={12}/></button>
</div>}
