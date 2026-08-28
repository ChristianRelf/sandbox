import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Clock3, Download, MoreHorizontal, Play, Plus, Search, Trash2, Upload } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { api } from "../api";
import { definitionFor } from "../catalogue";
import { usePreferences } from "../preferences";
import { useAppStore } from "../store";
import { Status } from "./Status";
import { EmptyState } from "./EmptyState";

const templates = [
  { key: "website-change-monitor", name: "Website Change Monitor", flow: "Schedule → Browser → Extract → Condition → Notify" },
  { key: "download-daily-report", name: "Download Daily Report", flow: "Schedule → Browser → Download → Notify" },
  { key: "email-enquiry-draft", name: "Email Enquiry Draft", flow: "New email → Condition → Draft → Notify" },
  { key: "website-status-discord", name: "Website Status to Discord", flow: "Schedule → HTTP → Condition → Discord" },
  { key: "downloads-organiser", name: "Downloads Folder Organiser", flow: "File watch → Condition → Move file" },
];

export function Dashboard() {
  const { workflows, load, loading, openWorkflow, createWorkflow, deleteWorkflow } = useAppStore();
  const dateDisplay = usePreferences(state => state.dateDisplay);
  const [search, setSearch] = useState("");
  const [running, setRunning] = useState<string>();
  useEffect(() => { load(); }, [load]);
  const filtered = useMemo(() => workflows.filter(item => item.workflow.name.toLowerCase().includes(search.toLowerCase())), [workflows, search]);
  const run = async (id: string) => {
    setRunning(id);
    try { await api.runWorkflow(id); await load(); } finally { setRunning(undefined); }
  };
  const importWorkflow = async () => {
    const imported = await api.importWorkflow();
    if (imported) {
      await load();
      openWorkflow(imported.id);
    }
  };
  if (!loading && !workflows.length) return <main className="content"><PageHeader onCreate={() => createWorkflow()} onImport={importWorkflow} /><EmptyState onCreate={() => createWorkflow()} onTemplate={createWorkflow} /></main>;
  return <main className="content">
    <PageHeader onCreate={() => createWorkflow()} onImport={importWorkflow} />
    <div className="toolbar"><div className="search"><Search size={15} /><input aria-label="Search workflows" placeholder="Search workflows…" value={search} onChange={event => setSearch(event.target.value)} /><kbd>/</kbd></div><span className="count">{filtered.length} workflow{filtered.length === 1 ? "" : "s"}</span></div>
    <div className="dashboard-grid"><section className="workflow-table" aria-label="Workflows">
      <div className="table-head"><span>Name</span><span>Trigger</span><span>Last run</span><span>Next run</span><span /></div>
      {filtered.map(({ workflow, lastExecution, nextRunAt }) => {
        const trigger = workflow.nodes.find(node => node.id === workflow.triggerNodeId);
        const TriggerIcon = trigger ? definitionFor(trigger.type).icon : Clock3;
        return <div className="workflow-row" key={workflow.id} tabIndex={0} onDoubleClick={() => openWorkflow(workflow.id)} onKeyDown={event => event.key === "Enter" && openWorkflow(workflow.id)}>
          <div className="workflow-name"><span className={`enable-dot ${workflow.enabled ? "enabled" : ""}`} /><div><b>{workflow.name}</b><small>{workflow.description || `${workflow.nodes.length} nodes · Updated ${formatDate(workflow.updatedAt, dateDisplay)}`}</small></div></div>
          <div className="muted-cell"><TriggerIcon size={14} />{trigger?.name ?? "Missing trigger"}</div>
          <div>{lastExecution ? <><Status status={lastExecution.status} /><small>{formatDate(lastExecution.startedAt, dateDisplay)}</small></> : <span className="muted">Never run</span>}</div>
          <div className="muted-cell">{nextRunAt ? <><Clock3 size={14} />{formatDate(nextRunAt, dateDisplay)}</> : <span>—</span>}</div>
          <div className="row-actions"><button className="icon-button" title="Run workflow" aria-label={`Run ${workflow.name}`} disabled={running === workflow.id} onClick={() => run(workflow.id)}><Play size={14} fill="currentColor" /></button><DropdownMenu.Root><DropdownMenu.Trigger asChild><button className="icon-button" aria-label={`More actions for ${workflow.name}`}><MoreHorizontal size={16} /></button></DropdownMenu.Trigger><DropdownMenu.Portal><DropdownMenu.Content className="menu" align="end"><DropdownMenu.Item onSelect={() => openWorkflow(workflow.id)}>Open workflow</DropdownMenu.Item><DropdownMenu.Item onSelect={() => run(workflow.id)}>Run now</DropdownMenu.Item><DropdownMenu.Item onSelect={() => api.exportWorkflow(workflow.id)}><Download size={14} />Export securely</DropdownMenu.Item><DropdownMenu.Separator /><DropdownMenu.Item className="danger" onSelect={() => confirm(`Delete ${workflow.name}?`) && deleteWorkflow(workflow.id)}><Trash2 size={14} />Delete</DropdownMenu.Item></DropdownMenu.Content></DropdownMenu.Portal></DropdownMenu.Root></div>
        </div>;
      })}
    </section>
    {workflows.length > 0 && <section className="compact-templates"><div className="compact-templates-heading"><span>Quick start</span><h3>Start from a template</h3><p>Imports stay disabled until you review permissions and connections.</p></div><div className="template-grid">{templates.map(template => <button key={template.key} onClick={() => createWorkflow(template.key)}><b>{template.name}</b><small>{template.flow}</small></button>)}</div></section>}
    </div>
  </main>;
}

function formatDate(value: string, display: "relative" | "absolute") {
  const date = new Date(value);
  return display === "relative"
    ? formatDistanceToNow(date, { addSuffix: true })
    : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function PageHeader({ onCreate, onImport }: { onCreate: () => void; onImport?: () => void }) {
  return <header className="page-header"><div><h1>Workflows</h1><p>Build and run automations on this device.</p></div>{onImport && <button className="button" onClick={onImport}><Upload size={14} />Import</button>}<button className="button primary" onClick={onCreate}><Plus size={15} />Create workflow</button></header>;
}
