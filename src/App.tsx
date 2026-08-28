import { lazy, Suspense, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { CommandPalette } from "./components/CommandPalette";
import { Dashboard } from "./components/Dashboard";
import { Sidebar } from "./components/Sidebar";
import { api } from "./api";
import type { PendingApproval } from "./types";
import { useAppStore } from "./store";
import "./plugins.css";

const HistoryView = lazy(() => import("./components/HistoryView").then(module => ({ default: module.HistoryView })));
const WorkflowEditor = lazy(() => import("./components/WorkflowEditor").then(module => ({ default: module.WorkflowEditor })));
const SettingsView = lazy(() => import("./components/SettingsView").then(module => ({ default: module.SettingsView })));
const PendingApprovalsView = lazy(() => import("./components/PendingApprovalsView").then(module => ({ default: module.PendingApprovalsView })));
const InstalledPluginsView = lazy(() => import("./components/InstalledPluginsView").then(module => ({ default: module.InstalledPluginsView })));
const MarketplaceView = lazy(() => import("./components/MarketplaceView").then(module => ({ default: module.MarketplaceView })));
const ApprovalRequest = lazy(() => import("./components/ApprovalRequest").then(module => ({ default: module.ApprovalRequest })));

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
      <Suspense fallback={<main className="route-loading" role="status">Loading view…</main>}>
        {view === "workflows" && <Dashboard />}
        {view === "history" && <HistoryView />}
        {view === "settings" && <SettingsView />}
        {view === "approvals" && <PendingApprovalsView />}
        {view === "plugins" && <InstalledPluginsView />}
        {view === "marketplace" && <MarketplaceView />}
        {view === "editor" && activeWorkflow && <WorkflowEditor />}
      </Suspense>
    </div>
    <CommandPalette open={commandOpen} onClose={() => setCommandOpen(false)} onCreate={() => createWorkflow()} />
    {approvalPrompt && <Suspense fallback={null}><ApprovalRequest item={approvalPrompt} modal busy={approvalBusy} onDismiss={() => { setApprovalPrompt(undefined); setView("approvals"); }} onResolve={approved => void resolvePrompt(approved)} /></Suspense>}
  </div>;
}
