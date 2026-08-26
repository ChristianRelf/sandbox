import { useEffect, useState } from "react";
import { CommandPalette } from "./components/CommandPalette";
import { Dashboard } from "./components/Dashboard";
import { HistoryView } from "./components/HistoryView";
import { Sidebar } from "./components/Sidebar";
import { WorkflowEditor } from "./components/WorkflowEditor";
import { SettingsView } from "./components/SettingsView";
import { useAppStore } from "./store";

export default function App(){const {view,activeWorkflow,createWorkflow}=useAppStore();const [commandOpen,setCommandOpen]=useState(false);useEffect(()=>{const key=(e:KeyboardEvent)=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="k"&&view!=="editor"){e.preventDefault();setCommandOpen(v=>!v)}};window.addEventListener("keydown",key);return()=>window.removeEventListener("keydown",key)},[view]);const openCommands=()=>view==="editor"?window.dispatchEvent(new CustomEvent("sandbox:open-node-picker")):setCommandOpen(true);return <div className="app-shell"><Sidebar onCommand={openCommands}/><div className="app-main">{view==="workflows"&&<Dashboard/>}{view==="history"&&<HistoryView/>}{view==="settings"&&<SettingsView/>}{view==="editor"&&activeWorkflow&&<WorkflowEditor/>}</div><CommandPalette open={commandOpen} onClose={()=>setCommandOpen(false)} onCreate={()=>createWorkflow()}/></div>}
