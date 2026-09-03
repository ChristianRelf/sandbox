import * as Tabs from "@radix-ui/react-tabs";
import {
  ChevronRight,
  Clipboard,
  Copy,
  ExternalLink,
  Image,
  LocateFixed,
  RotateCcw,
  Square,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { format, formatDistanceStrict } from "date-fns";
import { api } from "../api";
import { executionErrorIssue } from "../issues";
import { useToast } from "./ui/Toast";
import type { ExecutionRecord, NodeExecution, Workflow } from "../types";
import { Status } from "./Status";
import { IssueNotice } from "./ui/IssueNotice";
import "./collection-evidence.css";

interface ExecutionInspectorProps {
  run: ExecutionRecord;
  workflow?: Workflow;
  onRetry: () => void;
  onRetryNode?: (nodeId: string) => void;
  onRetryHeaded?: () => void;
  onEditNode?: (nodeId: string) => void;
  onReviewPermissions?: (request: PermissionReviewRequest) => void;
  onClear?: () => void;
  compact?: boolean;
}

export interface PermissionReviewRequest {
  nodeId?: string;
  message: string;
}

export function ExecutionInspector({
  run,
  workflow,
  onRetry,
  onRetryNode,
  onRetryHeaded,
  onEditNode,
  onReviewPermissions,
  onClear,
  compact = false,
}: ExecutionInspectorProps) {
  const firstNode = () =>
    run.nodeExecutions.find((node) => node.status === "failed")?.nodeId ??
    run.nodeExecutions[0]?.nodeId;
  const [selected, setSelected] = useState(firstNode);
  useEffect(() => setSelected(firstNode()), [run.id]);
  const nodeRun = run.nodeExecutions.find((node) => node.nodeId === selected);
  const node = workflow?.nodes.find((item) => item.id === selected);
  const permissionFailure = run.nodeExecutions.find(
    (entry) => entry.error?.code === "permission_required",
  );
  const copy = async (value: unknown) =>
    navigator.clipboard.writeText(
      typeof value === "string" ? value : JSON.stringify(value, null, 2),
    );

  return (
    <div className={`execution-inspector ${compact ? "compact" : ""}`}>
      <div className="run-summary">
        <div>
          <Status status={run.status} />
          <h2>{workflow?.name ?? "Workflow execution"}</h2>
          <p>
            {format(new Date(run.startedAt), "dd MMM yyyy · HH:mm:ss")} ·{" "}
            {run.durationMs != null
              ? formatDuration(run.durationMs)
              : "In progress"}
          </p>
        </div>
        <div className="run-actions">
          {run.status === "running" && (
            <button
              className="button"
              onClick={() => api.cancelExecution(run.id)}
            >
              <Square size={13} />
              Cancel
            </button>
          )}
          {nodeRun?.status === "failed" && onRetryNode && (
            <button
              className="button"
              onClick={() => onRetryNode(nodeRun.nodeId)}
            >
              <RotateCcw size={13} />
              Retry failed node
            </button>
          )}
          {nodeRun?.browserDiagnostics && onRetryHeaded && (
            <button className="button" onClick={onRetryHeaded}>
              <ExternalLink size={13} />
              Retry headed
            </button>
          )}
          {run.error && (
            <button className="button" onClick={() => copy(run.error?.message)}>
              <Copy size={13} />
              Copy error
            </button>
          )}
          <button className="button" onClick={onRetry}>
            <RotateCcw size={13} />
            Retry workflow
          </button>
          {onClear && (
            <button
              className="icon-button"
              title="Clear old execution history"
              aria-label="Clear old execution history"
              onClick={onClear}
            >
              <Trash2 size={15} />
            </button>
          )}
        </div>
      </div>
      {run.error && (
        <IssueNotice
          issue={executionErrorIssue(run.error)}
          context={{ workflowId: workflow?.id, executionId: run.id, nodeId: permissionFailure?.nodeId }}
          onFix={run.error.code === "permission_required" && onReviewPermissions
            ? () => onReviewPermissions({ nodeId: permissionFailure?.nodeId, message: run.error!.message })
            : undefined}
          fixLabel="Review permissions"
        />
      )}
      {run.skipReason && <div className="info-note">{run.skipReason}</div>}
      <div className="execution-body">
        <div className="timeline">
          <div className="timeline-label">Execution timeline</div>
          {run.nodeExecutions.map((entry, index) => {
            const item = workflow?.nodes.find(
              (candidate) => candidate.id === entry.nodeId,
            );
            return (
              <button
                key={entry.nodeId}
                className={selected === entry.nodeId ? "selected" : ""}
                onClick={() => setSelected(entry.nodeId)}
              >
                <span className="timeline-rail">
                  {index < run.nodeExecutions.length - 1 && <i />}
                  <Status status={entry.status} label={false} />
                </span>
                <span>
                  <b>{item?.name ?? entry.nodeId}</b>
                  <small>
                    {entry.skipReason ??
                      (entry.durationMs != null
                        ? formatDuration(entry.durationMs)
                        : entry.status)}
                  </small>
                </span>
                {entry.retryCount > 0 && <em>{entry.retryCount} retries</em>}
              </button>
            );
          })}
        </div>
        {nodeRun && (
          <NodeExecutionDetail
            execution={nodeRun}
            name={node?.name ?? nodeRun.nodeId}
            workflowId={workflow?.id}
            executionId={run.id}
            onCopy={copy}
            onEditNode={onEditNode}
          />
        )}
      </div>
    </div>
  );
}

function NodeExecutionDetail({
  execution,
  name,
  workflowId,
  executionId,
  onCopy,
  onEditNode,
}: {
  execution: NodeExecution;
  name: string;
  workflowId?: string;
  executionId: string;
  onCopy: (value: unknown) => void;
  onEditNode?: (nodeId: string) => void;
}) {
  const itemPreviewCount=execution.collection?.sampleItems?.length??execution.outputItems?.length??0;
  return (
    <div className="node-execution-detail">
      <header>
        <div>
          <h3>{name}</h3>
          <Status status={execution.status} />
        </div>
        <div>
          <span>
            Duration{" "}
            <b>
              {execution.durationMs != null
                ? formatDuration(execution.durationMs)
                : "—"}
            </b>
          </span>
          <span>
            Retries <b>{execution.retryCount}</b>
          </span>
        </div>
      </header>
      {execution.error && (
        <IssueNotice
          issue={executionErrorIssue(execution.error)}
          compact
          context={{ workflowId, executionId, nodeId: execution.nodeId }}
          onFix={execution.error.code !== "permission_required" && onEditNode
            ? () => onEditNode(execution.nodeId)
            : undefined}
          fixLabel={execution.error.code === "permission_required" ? "Review permissions" : "Open node"}
        />
      )}
      {execution.skipReason && (
        <div className="skip-detail">
          <b>Node skipped</b>
          <span>{execution.skipReason}</span>
          {execution.branchFollowed && (
            <span>Followed the {execution.branchFollowed} branch.</span>
          )}
        </div>
      )}
      {execution.browserDiagnostics && (
        <BrowserDiagnosticDetail
          diagnostics={execution.browserDiagnostics}
          nodeId={execution.nodeId}
          onCopy={onCopy}
          onEditNode={onEditNode}
        />
      )}
      {execution.collection && (
        <section className="collection-evidence" aria-label="Collection execution evidence">
          <div><small>Received</small><b>{execution.collection.inputItemCount}</b></div>
          <div><small>Produced</small><b>{execution.collection.outputItemCount}</b></div>
          <div><small>Removed / rejected</small><b>{execution.collection.rejectedItemCount}</b></div>
          {(execution.collection.iterationCount>0||execution.collection.batchCount>0)&&<div><small>Iterations / batches</small><b>{execution.collection.iterationCount} / {execution.collection.batchCount}</b></div>}
          <p>Ordering: {execution.collection.orderingPolicy||"not specified"}</p>
          {Object.keys(execution.collection.branchCounts??{}).length>0&&<p>Branches: {Object.entries(execution.collection.branchCounts??{}).map(([branch,count])=>`${branch} ${count}`).join(" · ")}</p>}
          {execution.collection.waitingForInputs?.length?<p>Waiting for: {execution.collection.waitingForInputs.join(", ")}</p>:null}
          {execution.collection.stopReason&&<p>Stopped: {execution.collection.stopReason}</p>}
          {execution.collection.previewTruncated&&<IssueNotice issue={{code:"bounded_preview",severity:"info",message:"Bounded preview",suggestion:"Authoritative counts and runtime data are preserved."}} compact context={{workflowId,executionId,nodeId:execution.nodeId}}/>}
        </section>
      )}
      <Tabs.Root defaultValue="output">
        <Tabs.List className="detail-tabs">
          <Tabs.Trigger value="input">Input</Tabs.Trigger>
          <Tabs.Trigger value="output">Output</Tabs.Trigger>
          {(execution.inputItems?.length||itemPreviewCount) ? <Tabs.Trigger value="items">Items <em>{itemPreviewCount}</em></Tabs.Trigger> : null}
          {execution.runtime && <Tabs.Trigger value="runtime">Runtime</Tabs.Trigger>}
          {(execution.lineage?.length||execution.capabilityUsage?.length) ? <Tabs.Trigger value="lineage">Lineage</Tabs.Trigger> : null}
          <Tabs.Trigger value="logs">
            Logs <em>{execution.logs.length}</em>
          </Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="input">
          <CodeBlock value={execution.input} onCopy={onCopy} />
        </Tabs.Content>
        <Tabs.Content value="output">
          <CodeBlock value={execution.output} onCopy={onCopy} />
        </Tabs.Content>
        <Tabs.Content value="items">
          <ItemExplorer execution={execution} onCopy={onCopy}/>
        </Tabs.Content>
        <Tabs.Content value="runtime">
          <CodeBlock value={{...execution.runtime,testDataSource:execution.testDataSource??"live execution",warnings:execution.warnings??[]}} onCopy={onCopy} />
        </Tabs.Content>
        <Tabs.Content value="lineage">
          <CodeBlock value={{sources:execution.lineage??[],capabilities:execution.capabilityUsage??[]}} onCopy={onCopy} />
        </Tabs.Content>
        <Tabs.Content value="logs">
          <div className="logs">
            {execution.logs.length ? (
              execution.logs.map((log, index) => (
                <div key={index}>
                  <span>{index + 1}</span>
                  {log}
                </div>
              ))
            ) : (
              <p>No logs were recorded for this node.</p>
            )}
          </div>
        </Tabs.Content>
      </Tabs.Root>
    </div>
  );
}

function ItemExplorer({execution,onCopy}:{execution:NodeExecution;onCopy:(value:unknown)=>void}){
  const [search,setSearch]=useState("");
  const [status,setStatus]=useState("all");
  const [selected,setSelected]=useState<string>();
  const samples=execution.collection?.sampleItems??[];
  const items=samples.length?samples:(execution.outputItems??[]);
  const filtered=items.filter(item=>(status==="all"||(item.status??"successful")===status)&&(!search||JSON.stringify(item).toLowerCase().includes(search.toLowerCase())));
  const current=filtered.find(item=>(item.itemId??`${item.sourceNodeId}:${item.currentPosition}`)===selected)??filtered[0];
  const before=current?.parentItemId?execution.inputItems?.find(item=>item.itemId===current.parentItemId||item.itemId===current.originItemId):execution.inputItems?.find(item=>item.itemId===current?.originItemId);
  return <div className="item-explorer">
    <div className="item-filter"><input aria-label="Search execution items" placeholder="Search items" value={search} onChange={event=>setSearch(event.target.value)}/><select aria-label="Filter item state" value={status} onChange={event=>setStatus(event.target.value)}><option value="all">All states</option>{["successful","failed","filtered","removed","unmatched","retried","skipped"].map(value=><option key={value}>{value}</option>)}</select><span>{filtered.length} shown{execution.collection?.previewTruncated?" (preview)":""}</span></div>
    <div className="item-results"><div className="item-list">{filtered.map((item,index)=>{const id=item.itemId??`${item.sourceNodeId??"item"}:${item.currentPosition??index}`;return <button key={id} className={current===item?"selected":""} onClick={()=>setSelected(id)}><b>{id}</b><small>{item.status??"successful"}{item.branch?` · ${item.branch}`:""}{item.loopIteration!=null?` · iteration ${item.loopIteration}`:""}</small></button>})}</div>{current?<div className="item-trace"><p><b>Lineage</b> {current.originItemId??current.itemId??"unassigned"}{current.parentItemId?` ← ${current.parentItemId}`:""}</p><CodeBlock value={{before:before?.data??null,after:current.data,branchHistory:current.branchHistory??[],correlations:current.correlations??{},attempt:current.executionAttempt??1}} onCopy={onCopy}/></div>:<p>No preview items match this filter.</p>}</div>
  </div>;
}

function BrowserDiagnosticDetail({
  diagnostics,
  nodeId,
  onCopy,
  onEditNode,
}: {
  diagnostics: NonNullable<NodeExecution["browserDiagnostics"]>;
  nodeId: string;
  onCopy: (value: unknown) => void;
  onEditNode?: (nodeId: string) => void;
}) {
  const toast = useToast();
  const successful = diagnostics.successfulLocator;
  const weak = diagnostics.locatorAttempts.some(
    (attempt) => attempt.succeeded && attempt.weakFallback,
  );
  const openScreenshot = async () => {
    if (!diagnostics.screenshotPath) return;
    try {
      await api.openExecutionArtifact(diagnostics.screenshotPath);
    } catch (error) {
      toast.push(String(error), "error");
    }
  };
  return (
    <section className="browser-diagnostics">
      <header>
        <span>
          <LocateFixed size={14} />
          Browser evidence
        </span>
        <div>
          {diagnostics.screenshotPath && (
            <button className="button" onClick={openScreenshot}>
              <Image size={13} />
              Open screenshot
            </button>
          )}
          {onEditNode && diagnostics.rerecordAvailable && (
            <button className="button" onClick={() => onEditNode(nodeId)}>
              <LocateFixed size={13} />
              Replace locator
            </button>
          )}
          <button className="button" onClick={() => onCopy(diagnostics)}>
            <Copy size={13} />
            Copy technical details
          </button>
        </div>
      </header>
      <div className="diagnostic-context">
        <span>
          <small>Current URL</small>
          <b>{diagnostics.currentUrl || "Unavailable"}</b>
        </span>
        <span>
          <small>Page title</small>
          <b>{diagnostics.pageTitle || "Unavailable"}</b>
        </span>
        <span>
          <small>Matches</small>
          <b>{diagnostics.matchCount}</b>
        </span>
      </div>
      {diagnostics.playwrightError && (
        <IssueNotice issue={{code:"browser_engine_diagnostic",severity:"error",message:"Browser engine reported an error",suggestion:diagnostics.playwrightError}} compact context={{nodeId}} onFix={onEditNode ? () => onEditNode(nodeId) : undefined} fixLabel="Open node" />
      )}
      {weak && (
        <IssueNotice issue={{code:"weak_locator_fallback",severity:"warning",message:"Weak locator fallback used",suggestion:"The target matched only after stronger accessible locators failed."}} compact context={{nodeId}} onFix={onEditNode ? () => onEditNode(nodeId) : undefined} fixLabel="Replace locator" />
      )}
      {diagnostics.unexpectedNavigation && (
        <IssueNotice issue={{code:"unexpected_navigation",severity:"warning",message:"Unexpected navigation",suggestion:"The page navigated when this node did not declare a navigation."}} compact context={{nodeId}} onFix={onEditNode ? () => onEditNode(nodeId) : undefined} fixLabel="Open node" />
      )}
      <details open={Boolean(diagnostics.locatorAttempts.length)}>
        <summary>
          Locator attempts ({diagnostics.locatorAttempts.length})
        </summary>
        <div className="locator-attempts">
          {diagnostics.locatorAttempts.length ? (
            diagnostics.locatorAttempts.map((attempt, index) => (
              <div
                key={`${attempt.kind}-${index}`}
                className={attempt.succeeded ? "succeeded" : "failed"}
              >
                <span>{index + 1}</span>
                <code>{attempt.kind}</code>
                <b>{attempt.value}</b>
                <em>
                  {attempt.matchCount} match
                  {attempt.matchCount === 1 ? "" : "es"}
                </em>
                {attempt.error && <small>{attempt.error}</small>}
              </div>
            ))
          ) : (
            <p>No locator was required for this browser step.</p>
          )}
        </div>
      </details>
      {successful && (
        <p className="successful-locator">
          Succeeded with <code>{successful.kind}</code> · {successful.value}
        </p>
      )}
      {(diagnostics.consoleErrors.length > 0 ||
        diagnostics.failedNetworkRequests.length > 0) && (
        <details>
          <summary>
            Console and network evidence (
            {diagnostics.consoleErrors.length +
              diagnostics.failedNetworkRequests.length}
            )
          </summary>
          <div className="diagnostic-errors">
            {diagnostics.consoleErrors.map((error, index) => (
              <p key={`console-${index}`}>
                <b>Console</b>
                {error}
              </p>
            ))}
            {diagnostics.failedNetworkRequests.map((error, index) => (
              <p key={`network-${index}`}>
                <b>Network</b>
                {error}
              </p>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}

function CodeBlock({
  value,
  onCopy,
}: {
  value: unknown;
  onCopy: (value: unknown) => void;
}) {
  return (
    <div className="code-block">
      <button onClick={() => onCopy(value)} title="Copy">
        <Clipboard size={13} />
      </button>
      <pre>{JSON.stringify(value, null, 2) ?? "null"}</pre>
    </div>
  );
}

const formatDuration = (ms: number) =>
  ms < 1000
    ? `${ms} ms`
    : formatDistanceStrict(0, ms, { unit: ms < 60000 ? "second" : "minute" });
