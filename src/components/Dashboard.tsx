import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  Archive,
  Clock3,
  Copy,
  Download,
  Filter,
  Folder,
  MoreHorizontal,
  Play,
  Plus,
  RotateCcw,
  Search,
  Star,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { api } from "../api";
import { definitionFor } from "../catalogue";
import { usePreferences } from "../preferences";
import { useAppStore } from "../store";
import type { WorkflowSummary } from "../types";
import { Status } from "./Status";
import { ConfirmDialog, Dialog } from "./ui/Dialog";
import { EmptyState, ErrorState, LoadingSkeleton } from "./ui/States";
import { useToast } from "./ui/Toast";

const templates = [
  {
    key: "blank",
    name: "Blank workflow",
    flow: "Manual trigger",
    requirements: "No integrations required",
  },
  {
    key: "website-change-monitor",
    name: "Website Change Monitor",
    flow: "Schedule → Browser → Extract → Condition → Notify",
    requirements: "Managed browser profile",
  },
  {
    key: "download-daily-report",
    name: "Download Daily Report",
    flow: "Schedule → Browser → Download → Notify",
    requirements: "Managed browser profile and folder access",
  },
  {
    key: "email-enquiry-draft",
    name: "Email Enquiry Draft",
    flow: "New email → Condition → Draft → Notify",
    requirements: "Gmail connection",
  },
  {
    key: "website-status-discord",
    name: "Website Status to Discord",
    flow: "Schedule → HTTP → Condition → Discord",
    requirements: "Discord webhook connection",
  },
  {
    key: "downloads-organiser",
    name: "Downloads Folder Organiser",
    flow: "File watch → Condition → Move file",
    requirements: "Folder access",
  },
];
type FilterKey = "all" | "favorites" | "scheduled" | "failed" | "archived";

export function Dashboard() {
  const { openWorkflow, createWorkflow } = useAppStore();
  const dateDisplay = usePreferences((state) => state.dateDisplay);
  const toast = useToast();
  const [items, setItems] = useState<WorkflowSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("modified");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [folder, setFolder] = useState("");
  const [running, setRunning] = useState<string>();
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [template, setTemplate] = useState(templates[0]);
  const [name, setName] = useState(templates[0].name);
  const [confirm, setConfirm] = useState<{
    kind: "archive" | "purge";
    item: WorkflowSummary;
  }>();
  const [organize, setOrganize] = useState<WorkflowSummary>();
  const [organizeFolder, setOrganizeFolder] = useState("");
  const [tags, setTags] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const load = async () => {
    setLoading(true);
    setError(undefined);
    try {
      setItems(await api.listWorkflows(true));
    } catch (value) {
      setError(String(value));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
    const create = () => setCreateOpen(true);
    window.addEventListener("sandbox:create-workflow", create);
    return () => window.removeEventListener("sandbox:create-workflow", create);
  }, []);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        event.key === "/" &&
        !event.ctrlKey &&
        !event.metaKey &&
        !(target instanceof Element && target.closest("input,textarea,select"))
      ) {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  const folders = useMemo(
    () =>
      [
        ...new Set(
          items.map((item) => item.metadata.folder).filter(Boolean) as string[],
        ),
      ].sort(),
    [items],
  );
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return items
      .filter((item) => {
        const { workflow, metadata, lastExecution, nextRunAt } = item;
        if (filter === "archived" ? !metadata.archivedAt : metadata.archivedAt)
          return false;
        if (filter === "favorites" && !metadata.favorite) return false;
        if (filter === "scheduled" && !nextRunAt) return false;
        if (filter === "failed" && lastExecution?.status !== "failed")
          return false;
        if (folder && metadata.folder !== folder) return false;
        if (
          needle &&
          ![
            workflow.name,
            workflow.description,
            metadata.folder ?? "",
            ...metadata.tags,
          ]
            .join(" ")
            .toLowerCase()
            .includes(needle)
        )
          return false;
        return true;
      })
      .sort((a, b) =>
        sort === "name"
          ? a.workflow.name.localeCompare(b.workflow.name)
          : sort === "last-run"
            ? (b.lastExecution?.startedAt ?? "").localeCompare(
                a.lastExecution?.startedAt ?? "",
              )
            : sort === "next-run"
              ? (a.nextRunAt ?? "z").localeCompare(b.nextRunAt ?? "z")
              : b.workflow.updatedAt.localeCompare(a.workflow.updatedAt),
      );
  }, [filter, folder, items, search, sort]);
  const run = async (id: string) => {
    setRunning(id);
    try {
      await api.runWorkflow(id);
      toast.push("Workflow run started.", "success");
      await load();
    } catch (value) {
      toast.push(String(value), "error");
    } finally {
      setRunning(undefined);
    }
  };
  const importWorkflow = async () => {
    try {
      const imported = await api.importWorkflow();
      if (imported) {
        await load();
        await openWorkflow(imported.id);
      }
    } catch (value) {
      toast.push(String(value), "error");
    }
  };
  const submitCreate = async () => {
    if (!name.trim()) return;
    setCreating(true);
    try {
      await createWorkflow(
        template.key === "blank" ? undefined : template.key,
        name.trim(),
      );
      setCreateOpen(false);
    } catch (value) {
      toast.push(String(value), "error");
    } finally {
      setCreating(false);
    }
  };
  const updateMetadata = async (
    id: string,
    patch: Parameters<typeof api.updateWorkflowMetadata>[1],
  ) => {
    try {
      await api.updateWorkflowMetadata(id, patch);
      await load();
      return true;
    } catch (value) {
      toast.push(String(value), "error");
      return false;
    }
  };
  const actConfirm = async () => {
    if (!confirm) return;
    try {
      if (confirm.kind === "archive")
        await api.archiveWorkflow(confirm.item.workflow.id);
      else await api.purgeWorkflow(confirm.item.workflow.id);
      toast.push(
        confirm.kind === "archive"
          ? "Workflow archived."
          : "Workflow permanently deleted.",
        "success",
      );
      setConfirm(undefined);
      await load();
    } catch (value) {
      toast.push(String(value), "error");
    }
  };
  const duplicate = async (item: WorkflowSummary) => {
    try {
      const created = await api.duplicateWorkflow(item.workflow.id);
      toast.push(`Created ${created.name}.`, "success");
      await load();
    } catch (value) {
      toast.push(String(value), "error");
    }
  };
  const clear = () => {
    setSearch("");
    setFilter("all");
    setFolder("");
  };
  const activeFilters = Boolean(search || filter !== "all" || folder);
  return (
    <main className="content">
      <header className="page-header">
        <div>
          <h1>Workflows</h1>
          <p>Build, organise, and run automations on this device.</p>
        </div>
        <button className="button" onClick={() => void importWorkflow()}>
          <Upload size={14} />
          Import
        </button>
        <button className="button primary" onClick={() => setCreateOpen(true)}>
          <Plus size={15} />
          Create workflow
        </button>
      </header>
      <div className="toolbar dashboard-toolbar">
        <div className="search">
          <Search size={15} />
          <input
            ref={searchRef}
            aria-label="Search workflows"
            placeholder="Search name, description, folder, or tags…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          {search ? (
            <button aria-label="Clear search" onClick={() => setSearch("")}>
              <X size={13} />
            </button>
          ) : (
            <kbd>/</kbd>
          )}
        </div>
        <select
          aria-label="Filter workflows"
          value={filter}
          onChange={(event) => setFilter(event.target.value as FilterKey)}
        >
          <option value="all">All workflows</option>
          <option value="favorites">Favorites</option>
          <option value="scheduled">Scheduled</option>
          <option value="failed">Failed</option>
          <option value="archived">Archived</option>
        </select>
        <select
          aria-label="Filter by folder"
          value={folder}
          onChange={(event) => setFolder(event.target.value)}
        >
          <option value="">All folders</option>
          {folders.map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
        <select
          aria-label="Sort workflows"
          value={sort}
          onChange={(event) => setSort(event.target.value)}
        >
          <option value="modified">Last modified</option>
          <option value="name">Name</option>
          <option value="last-run">Last run</option>
          <option value="next-run">Next run</option>
        </select>
        {activeFilters && (
          <button className="button" onClick={clear}>
            <Filter size={13} />
            Clear
          </button>
        )}
        <span className="count">
          {filtered.length} workflow{filtered.length === 1 ? "" : "s"}
        </span>
      </div>
      {loading ? (
        <LoadingSkeleton rows={6} />
      ) : error ? (
        <ErrorState
          title="Workflows could not load"
          description={error}
          onRetry={load}
        />
      ) : !items.length ? (
        <EmptyState
          title="Create your first workflow"
          description="Start blank or choose a reviewed template. No workflow record is created until you confirm its name."
          action={
            <button
              className="button primary"
              onClick={() => setCreateOpen(true)}
            >
              Create workflow
            </button>
          }
        />
      ) : !filtered.length ? (
        <EmptyState
          title="No matching workflows"
          description="No workflow matches the current search and filters."
          action={
            <button className="button" onClick={clear}>
              Clear search and filters
            </button>
          }
        />
      ) : (
        <section className="workflow-table" aria-label="Workflows">
          <div className="table-head">
            <span>Name</span>
            <span>Trigger</span>
            <span>Last run</span>
            <span>Next run</span>
            <span />
          </div>
          {filtered.map((item) => (
            <WorkflowRow
              key={item.workflow.id}
              item={item}
              dateDisplay={dateDisplay}
              running={running === item.workflow.id}
              onOpen={() => void openWorkflow(item.workflow.id)}
              onRun={() => void run(item.workflow.id)}
              onFavorite={() =>
                void updateMetadata(item.workflow.id, {
                  favorite: !item.metadata.favorite,
                })
              }
              onDuplicate={() => void duplicate(item)}
              onOrganize={() => {
                setOrganize(item);
                setOrganizeFolder(item.metadata.folder ?? "");
                setTags(item.metadata.tags.join(", "));
              }}
              onArchive={() => setConfirm({ kind: "archive", item })}
              onRestore={() =>
                void api
                  .restoreWorkflow(item.workflow.id)
                  .then(load)
                  .catch((value) => toast.push(String(value), "error"))
              }
              onExport={() =>
                void api
                  .exportWorkflow(item.workflow.id)
                  .then(
                    (path) =>
                      path &&
                      toast.push(`Exported ${item.workflow.name}.`, "success"),
                  )
                  .catch((error) => toast.push(String(error), "error"))
              }
              onPurge={() => setConfirm({ kind: "purge", item })}
            />
          ))}
        </section>
      )}
      <Dialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="Create workflow"
        description="Choose a starting point, then name the workflow before creating it."
        width="large"
        footer={
          <>
            <button
              className="button"
              disabled={creating}
              onClick={() => setCreateOpen(false)}
            >
              Cancel
            </button>
            <button
              className="button primary"
              disabled={!name.trim() || creating}
              onClick={() => void submitCreate()}
            >
              {creating ? "Creatingâ€¦" : "Create workflow"}
            </button>
          </>
        }
      >
        <div className="creation-layout">
          <div
            className="template-choices"
            role="radiogroup"
            aria-label="Workflow templates"
          >
            {templates.map((item) => (
              <button
                role="radio"
                aria-checked={template.key === item.key}
                className={template.key === item.key ? "active" : ""}
                key={item.key}
                onClick={() => {
                  setTemplate(item);
                  setName(item.name);
                }}
              >
                <b>{item.name}</b>
                <span>{item.flow}</span>
                <small>{item.requirements}</small>
              </button>
            ))}
          </div>
          <label className="field">
            <span>Workflow name</span>
            <input
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={120}
            />
          </label>
        </div>
      </Dialog>
      <Dialog
        open={Boolean(organize)}
        onOpenChange={(open) => !open && setOrganize(undefined)}
        title="Organize workflow"
        description="Folder and tags are local organization data and do not change exported workflows."
        footer={
          <>
            <button className="button" onClick={() => setOrganize(undefined)}>
              Cancel
            </button>
            <button
              className="button primary"
              onClick={() => {
                if (organize)
                  void updateMetadata(organize.workflow.id, {
                    folder: organizeFolder || null,
                    tags: tags.split(","),
                  }).then((saved) => saved && setOrganize(undefined));
              }}
            >
              Save organization
            </button>
          </>
        }
      >
        <label className="field">
          <span>Folder</span>
          <input
            value={organizeFolder}
            maxLength={64}
            onChange={(event) => setOrganizeFolder(event.target.value)}
          />
        </label>
        <label className="field">
          <span>
            Tags <small>Comma separated, up to 10</small>
          </span>
          <input
            value={tags}
            onChange={(event) => setTags(event.target.value)}
          />
        </label>
      </Dialog>
      <ConfirmDialog
        open={Boolean(confirm)}
        onOpenChange={(open) => !open && setConfirm(undefined)}
        title={
          confirm?.kind === "purge"
            ? "Permanently delete workflow?"
            : "Archive workflow?"
        }
        description={
          confirm?.kind === "purge"
            ? "The workflow, its execution history, and associated artifacts will be permanently deleted."
            : confirm?.item.workflow.enabled
              ? "This enabled workflow will be disabled before it is archived. Restoring it will not re-enable schedules."
              : "The workflow will move to Archived and remain disabled when restored."
        }
        confirmLabel={
          confirm?.kind === "purge" ? "Delete permanently" : "Archive"
        }
        dangerous
        onConfirm={() => void actConfirm()}
      />
    </main>
  );
}

function WorkflowRow({
  item,
  dateDisplay,
  running,
  onOpen,
  onRun,
  onFavorite,
  onDuplicate,
  onOrganize,
  onArchive,
  onRestore,
  onExport,
  onPurge,
}: {
  item: WorkflowSummary;
  dateDisplay: "relative" | "absolute";
  running: boolean;
  onOpen: () => void;
  onRun: () => void;
  onFavorite: () => void;
  onDuplicate: () => void;
  onOrganize: () => void;
  onArchive: () => void;
  onRestore: () => void;
  onExport: () => void;
  onPurge: () => void;
}) {
  const { workflow, metadata, lastExecution, nextRunAt } = item;
  const trigger = workflow.nodes.find(
    (node) => node.id === workflow.triggerNodeId,
  );
  const TriggerIcon = trigger ? definitionFor(trigger.type).icon : Clock3;
  const stop = (event: React.SyntheticEvent) => event.stopPropagation();
  return (
    <div
      className="workflow-row"
      tabIndex={0}
      role="link"
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter") onOpen();
      }}
    >
      <div className="workflow-name">
        <button
          className={`favorite ${metadata.favorite ? "active" : ""}`}
          aria-label={`${metadata.favorite ? "Remove" : "Add"} ${workflow.name} ${metadata.favorite ? "from" : "to"} favorites`}
          onClick={(event) => {
            stop(event);
            onFavorite();
          }}
        >
          <Star size={14} fill={metadata.favorite ? "currentColor" : "none"} />
        </button>
        <span className={`enable-dot ${workflow.enabled ? "enabled" : ""}`} />
        <div>
          <b>{workflow.name}</b>
          <small>
            {workflow.description ||
              `${workflow.nodes.length} ${workflow.nodes.length === 1 ? "node" : "nodes"} · Updated ${formatDate(workflow.updatedAt, dateDisplay)}`}
            {metadata.folder ? ` · ${metadata.folder}` : ""}
          </small>
        </div>
      </div>
      <div className="muted-cell">
        <TriggerIcon size={14} />
        {trigger?.name ?? "Missing trigger"}
      </div>
      <div>
        {lastExecution ? (
          <>
            <Status status={lastExecution.status} />
            <small>{formatDate(lastExecution.startedAt, dateDisplay)}</small>
          </>
        ) : (
          <span className="muted">Never run</span>
        )}
      </div>
      <div className="muted-cell">
        {nextRunAt ? (
          <>
            <Clock3 size={14} />
            {formatDate(nextRunAt, dateDisplay)}
          </>
        ) : (
          <span>—</span>
        )}
      </div>
      <div className="row-actions" onClick={stop}>
        <button
          className="icon-button"
          title="Run workflow"
          aria-label={`Run ${workflow.name}`}
          disabled={running || Boolean(metadata.archivedAt)}
          onClick={onRun}
        >
          <Play size={14} fill="currentColor" />
        </button>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              className="icon-button"
              aria-label={`More actions for ${workflow.name}`}
            >
              <MoreHorizontal size={16} />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content className="menu" align="end">
              <DropdownMenu.Item onSelect={onOpen}>
                Open workflow
              </DropdownMenu.Item>
              <DropdownMenu.Item onSelect={onDuplicate}>
                <Copy size={14} />
                Duplicate
              </DropdownMenu.Item>
              <DropdownMenu.Item onSelect={onOrganize}>
                <Folder size={14} />
                Organize
              </DropdownMenu.Item>
              <DropdownMenu.Item onSelect={onExport}>
                <Download size={14} />
                Export
              </DropdownMenu.Item>
              <DropdownMenu.Separator />
              {metadata.archivedAt ? (
                <>
                  <DropdownMenu.Item onSelect={onRestore}>
                    <RotateCcw size={14} />
                    Restore disabled
                  </DropdownMenu.Item>
                  <DropdownMenu.Item className="danger" onSelect={onPurge}>
                    <Trash2 size={14} />
                    Delete permanently
                  </DropdownMenu.Item>
                </>
              ) : (
                <DropdownMenu.Item className="danger" onSelect={onArchive}>
                  <Archive size={14} />
                  Archive
                </DropdownMenu.Item>
              )}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
    </div>
  );
}
function formatDate(value: string, display: "relative" | "absolute") {
  const date = new Date(value);
  return display === "relative"
    ? formatDistanceToNow(date, { addSuffix: true })
    : new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date);
}
