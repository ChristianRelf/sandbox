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
import { MarketplaceView } from "./components/MarketplaceView";
import { ApprovalRequest } from "./components/ApprovalRequest";
import { api } from "./api";
import type { PendingApproval } from "./types";
import { useAppStore } from "./store";
import "./plugins.css";

export default function App() {
  const { view, activeWorkflow, createWorkflow, setView } = useAppStore();
  const [commandOpen, setCommandOpen] = useState(false);
  const [approvalPrompt, setApprovalPrompt] = useState<PendingApproval>();
  const [approvalBusy, setApprovalBusy] = useState(false);
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
  useEffect(() => {
    if (!api.isDesktop) return;
    let stop: (() => void) | undefined;
    void api.listPendingApprovals().then(items => setApprovalPrompt(items[0]));
    void listen<PendingApproval>("approval-requested", event => setApprovalPrompt(event.payload)).then(unlisten => stop = unlisten);
    return () => stop?.();
  }, []);
  const resolvePrompt = async (approved: boolean) => {
    if (!approvalPrompt) return;
    setApprovalBusy(true);
    try { await api.resolvePendingApproval(approvalPrompt.id, approved); setApprovalPrompt(undefined); }
    finally { setApprovalBusy(false); }
  };
  const openCommands = () => view === "editor" ? window.dispatchEvent(new CustomEvent("sandbox:open-node-picker")) : setCommandOpen(true);
  return <div className="app-shell">
    <Sidebar onCommand={openCommands} />
    <div className="app-main">
      {view === "workflows" && <Dashboard />}
      {view === "history" && <HistoryView />}
      {view === "settings" && <SettingsView />}
      {view === "approvals" && <PendingApprovalsView />}
      {view === "plugins" && <InstalledPluginsView />}
      {view === "marketplace" && <MarketplaceView />}
      {view === "editor" && activeWorkflow && <WorkflowEditor />}
    </div>
    <CommandPalette open={commandOpen} onClose={() => setCommandOpen(false)} onCreate={() => createWorkflow()} />
    {approvalPrompt && <ApprovalRequest item={approvalPrompt} modal busy={approvalBusy} onDismiss={() => { setApprovalPrompt(undefined); setView("approvals"); }} onResolve={approved => void resolvePrompt(approved)} />}
  </div>;
}
