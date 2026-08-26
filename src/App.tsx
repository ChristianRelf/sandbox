import { useEffect, useState } from "react";
import { CommandPalette } from "./components/CommandPalette";
import { Dashboard } from "./components/Dashboard";
import { HistoryView } from "./components/HistoryView";
import { Sidebar } from "./components/Sidebar";
import { WorkflowEditor } from "./components/WorkflowEditor";
import { useAppStore } from "./store";

export default function App(){const {view,activeWorkflow,createWorkflow}=useAppStore();const [commandOpen,setCommandOpen]=useState(false);useEffect(()=>{const key=(e:KeyboardEvent)=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="k"){e.preventDefault();setCommandOpen(v=>!v)}};window.addEventListener("keydown",key);return()=>window.removeEventListener("keydown",key)},[]);return <div className="app-shell"><Sidebar onCommand={()=>setCommandOpen(true)}/><div className="app-main">{view==="workflows"&&<Dashboard/>}{view==="history"&&<HistoryView/>}{view==="editor"&&activeWorkflow&&<WorkflowEditor/>}</div><CommandPalette open={commandOpen} onClose={()=>setCommandOpen(false)} onCreate={()=>createWorkflow()}/></div>}
