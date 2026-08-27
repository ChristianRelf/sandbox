import { listen } from "@tauri-apps/api/event";
import { ShieldQuestion } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../api";
import type { PendingApproval } from "../types";
import { ApprovalRequest } from "./ApprovalRequest";

export function PendingApprovalsView() {
  const [items, setItems] = useState<PendingApproval[]>([]);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<string>();
  const load = () => api.listPendingApprovals().then(setItems).catch(value => setError(String(value)));
  useEffect(() => { void load(); if (!api.isDesktop) return; let stop: (() => void) | undefined; void listen("approval-requested", () => void load()).then(value => stop = value); return () => stop?.(); }, []);
  const resolve = async (id: string, approved: boolean) => { setBusy(id); setError(undefined); try { await api.resolvePendingApproval(id, approved); await load(); } catch (value) { setError(String(value)); } finally { setBusy(undefined); } };
  return <main className="content approvals-page"><header className="page-header"><div><h1>Pending Approvals</h1><p>Review local actions that are paused before execution continues.</p></div><span className="approval-count">{items.length} pending</span></header>{error && <div className="error-banner">{error}</div>}
    {items.length ? <div className="approval-list">{items.map(item => <ApprovalRequest key={item.id} item={item} busy={busy === item.id} onResolve={approved => void resolve(item.id, approved)} />)}</div> : <div className="settings-empty approval-empty"><ShieldQuestion size={22} /><h3>No pending approvals</h3><p>Workflows waiting for a local decision appear here and in the system tray.</p></div>}
  </main>;
}
