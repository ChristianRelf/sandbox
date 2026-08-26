import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { CommandPalette } from "./components/CommandPalette";
import { Dashboard } from "./components/Dashboard";
import { HistoryView } from "./components/HistoryView";
import { Sidebar } from "./components/Sidebar";
import { WorkflowEditor } from "./components/WorkflowEditor";
import { SettingsView } from "./components/SettingsView";
import { PendingApprovalsView } from "./components/PendingApprovalsView";
import { InstalledPluginsView } from "./components/InstalledPluginsView";
import { useAppStore } from "./store";
import "./plugins.css";

export default function App() {
  const { view, activeWorkflow, createWorkflow, setView } = useAppStore();
  const [commandOpen, setCommandOpen] = useState(false);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k" && view !== "editor") {
        event.preventDefault();
        setCommandOpen(value => !value);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [view]);
  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    let stop: (() => void) | undefined;
    void listen<string>("navigate", event => {
      if (event.payload === "approvals") setView("approvals");
    }).then(unlisten => stop = unlisten);
    return () => stop?.();
  }, [setView]);
  const openCommands = () => view === "editor" ? window.dispatchEvent(new CustomEvent("sandbox:open-node-picker")) : setCommandOpen(true);
  return <div className="app-shell">
    <Sidebar onCommand={openCommands} />
    <div className="app-main">
      {view === "workflows" && <Dashboard />}
      {view === "history" && <HistoryView />}
      {view === "settings" && <SettingsView />}
      {view === "approvals" && <PendingApprovalsView />}
      {view === "plugins" && <InstalledPluginsView />}
      {view === "editor" && activeWorkflow && <WorkflowEditor />}
    </div>
    <CommandPalette open={commandOpen} onClose={() => setCommandOpen(false)} onCreate={() => createWorkflow()} />
  </div>;
}
