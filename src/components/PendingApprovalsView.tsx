import { listen } from "@tauri-apps/api/event";
import { Check, Clock3, Paperclip, ShieldQuestion, X } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../api";
import type { PendingApproval } from "../types";

export function PendingApprovalsView() {
  const [items, setItems] = useState<PendingApproval[]>([]);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<string>();
  const load = () => api.listPendingApprovals().then(setItems).catch(value => setError(String(value)));
  useEffect(() => { void load(); if (!api.isDesktop) return; let stop: (() => void) | undefined; void listen("approval-requested", () => void load()).then(value => stop = value); return () => stop?.(); }, []);
  const resolve = async (id: string, approved: boolean) => { setBusy(id); setError(undefined); try { await api.resolvePendingApproval(id, approved); await load(); } catch (value) { setError(String(value)); } finally { setBusy(undefined); } };
  return <main className="content approvals-page"><header className="page-header"><div><h1>Pending Approvals</h1><p>Review local actions that are paused before execution continues.</p></div><span className="approval-count">{items.length} pending</span></header>{error && <div className="error-banner">{error}</div>}
    {items.length ? <div className="approval-list">{items.map(item => <article className="approval-card" key={item.id}><header><span><ShieldQuestion size={16} /></span><div><h2>{text(item.action.proposedAction, "Workflow action")}</h2><p>Expires {new Date(item.expiresAt).toLocaleString()}</p></div></header><dl><dt>Recipient</dt><dd>{text(item.action.recipient, "Not specified")}</dd><dt>Subject</dt><dd>{text(item.action.subject, "Not specified")}</dd><dt>Message preview</dt><dd className="message-preview">{text(item.action.messagePreview, "No preview provided")}</dd>{Array.isArray(item.action.attachments) && item.action.attachments.length > 0 && <><dt>Attachments</dt><dd><Paperclip size={12} />{item.action.attachments.length} approved file(s)</dd></>}</dl><footer><span><Clock3 size={12} />Local approval only</span><button className="button" disabled={busy === item.id} onClick={() => resolve(item.id, false)}><X size={13} />Reject</button><button className="button primary" disabled={busy === item.id} onClick={() => resolve(item.id, true)}><Check size={13} />Approve</button></footer></article>)}</div> : <div className="settings-empty approval-empty"><ShieldQuestion size={22} /><h3>No pending approvals</h3><p>Workflows waiting for a local decision appear here and in the system tray.</p></div>}
  </main>;
}
function text(value: unknown, fallback: string) { return typeof value === "string" && value.trim() ? value : fallback; }
