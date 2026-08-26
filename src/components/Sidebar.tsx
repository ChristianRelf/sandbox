import { Clock3, Command, GitFork, History, PanelLeftClose, PanelLeftOpen, Settings2 } from "lucide-react";
import { useState } from "react";
import { useAppStore, type View } from "../store";
export function Sidebar({onCommand}:{onCommand:()=>void}){const [collapsed,setCollapsed]=useState(false);const {view,setView}=useAppStore();const navigate=(next:View)=>{const dirty=(window as Window&{__sandboxUnsaved?:boolean}).__sandboxUnsaved;if(!dirty||confirm("Leave without saving your workflow changes?"))setView(next)};return <aside className={`sidebar ${collapsed?"sidebar-collapsed":""}`}>
  <div className="brand"><span className="brand-mark"><GitFork size={16}/></span>{!collapsed&&<span>Sandbox <small>local</small></span>}</div>
  <nav>
    <button className={view==="workflows"?"active":""} onClick={()=>navigate("workflows")}><GitFork size={16}/>{!collapsed&&"Workflows"}</button>
    <button className={view==="history"?"active":""} onClick={()=>navigate("history")}><History size={16}/>{!collapsed&&"Run history"}</button>
    <button className={view==="settings"?"active":""} onClick={()=>navigate("settings")}><Settings2 size={16}/>{!collapsed&&"Settings"}</button>
  </nav>
  {!collapsed&&<div className="sidebar-section"><span>Runner</span><div className="runner-line"><i/>Active locally</div><div className="runner-note"><Clock3 size={13}/>Schedules stop when you quit.</div></div>}
  <div className="sidebar-bottom"><button onClick={onCommand}><Command size={16}/>{!collapsed&&<>Commands <kbd>⌘K</kbd></>}</button><button aria-label="Toggle sidebar" onClick={()=>setCollapsed(v=>!v)}>{collapsed?<PanelLeftOpen size={16}/>:<PanelLeftClose size={16}/>} {!collapsed&&"Collapse"}</button></div>
</aside>}
