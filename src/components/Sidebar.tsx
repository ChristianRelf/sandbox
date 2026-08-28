import { Blocks, Clock3, Command, GitFork, History, PanelLeftClose, PanelLeftOpen, Search, ShieldQuestion, Settings2 } from "lucide-react";
import type { ReactNode } from "react";
import { usePreferences } from "../preferences";
import { useAppStore, type View } from "../store";
import { DesktopUpdateNotice } from "./DesktopUpdateNotice";
export function Sidebar({onCommand}:{onCommand:()=>void}){const {sidebarCollapsed:collapsed,confirmBeforeLeaving,update}=usePreferences();const {view,setView}=useAppStore();const navigate=(next:View)=>{const dirty=(window as Window&{__sandboxUnsaved?:boolean}).__sandboxUnsaved;if(!dirty||!confirmBeforeLeaving||confirm("Leave without saving your workflow changes?"))setView(next)};const item=(next:View,label:string,icon:ReactNode)=><button title={collapsed?label:undefined} aria-current={view===next?"page":undefined} className={view===next?"active":""} onClick={()=>navigate(next)}>{icon}{!collapsed&&label}</button>;return <aside className={`sidebar ${collapsed?"sidebar-collapsed":""}`}>
  <div className="brand"><span className="brand-mark"><GitFork size={16}/></span>{!collapsed&&<span>Sandbox <small>0.7 beta</small></span>}</div>
  <DesktopUpdateNotice collapsed={collapsed}/>
  <nav aria-label="Primary navigation">
    {item("workflows","Workflows",<GitFork size={16}/>) }
    {item("history","Run history",<History size={16}/>) }
    {item("marketplace","Marketplace",<Search size={16}/>) }
    {item("plugins","Installed plugins",<Blocks size={16}/>) }
    {item("settings","Settings",<Settings2 size={16}/>) }
    {item("approvals","Pending approvals",<ShieldQuestion size={16}/>) }
  </nav>
  {!collapsed&&<div className="sidebar-section"><span>Runner</span><div className="runner-line"><i/>Active locally</div><div className="runner-note"><Clock3 size={13}/>Schedules stop when you quit.</div></div>}
  <div className="sidebar-bottom"><button title={collapsed?"Commands":undefined} onClick={onCommand}><Command size={16}/>{!collapsed&&<>Commands <kbd>Ctrl K</kbd></>}</button><button aria-label={collapsed?"Expand sidebar":"Collapse sidebar"} onClick={()=>update({sidebarCollapsed:!collapsed})}>{collapsed?<PanelLeftOpen size={16}/>:<PanelLeftClose size={16}/>} {!collapsed&&"Collapse"}</button></div>
</aside>}
