import * as Tabs from "@radix-ui/react-tabs";
import { AlertTriangle, Clipboard, Copy, ExternalLink, Image, LocateFixed, RotateCcw, Square, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { format, formatDistanceStrict } from "date-fns";
import { api } from "../api";
import type { ExecutionRecord, NodeExecution, Workflow } from "../types";
import { Status } from "./Status";

interface ExecutionInspectorProps {
  run: ExecutionRecord;
  workflow?: Workflow;
  onRetry: () => void;
  onRetryNode?: (nodeId: string) => void;
  onRetryHeaded?: () => void;
  onEditNode?: (nodeId: string) => void;
  onClear?: () => void;
  compact?: boolean;
}

export function ExecutionInspector({
  run,
  workflow,
  onRetry,
  onRetryNode,
  onRetryHeaded,
  onEditNode,
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
            {run.durationMs != null ? formatDuration(run.durationMs) : "In progress"}
          </p>
        </div>
        <div className="run-actions">
          {run.status === "running" && (
            <button className="button" onClick={() => api.cancelExecution(run.id)}>
              <Square size={13} />Cancel
            </button>
          )}
          {nodeRun?.status === "failed" && onRetryNode && (
            <button className="button" onClick={() => onRetryNode(nodeRun.nodeId)}>
              <RotateCcw size={13} />Retry failed node
            </button>
          )}
          {nodeRun?.browserDiagnostics && onRetryHeaded && (
            <button className="button" onClick={onRetryHeaded}>
              <ExternalLink size={13} />Retry headed
            </button>
          )}
          {run.error && (
            <button className="button" onClick={() => copy(run.error?.message)}>
              <Copy size={13} />Copy error
            </button>
          )}
          <button className="button" onClick={onRetry}>
            <RotateCcw size={13} />Retry workflow
          </button>
          {onClear && (
            <button className="icon-button" title="Clear old execution history" onClick={onClear}>
              <Trash2 size={15} />
            </button>
          )}
        </div>
      </div>
      {run.error && (
        <div className="error-banner">
          <b>{run.error.message}</b>
          {run.error.suggestion && <span>{run.error.suggestion}</span>}
        </div>
      )}
      {run.skipReason && <div className="info-note">{run.skipReason}</div>}
      <div className="execution-body">
        <div className="timeline">
          <div className="timeline-label">Execution timeline</div>
          {run.nodeExecutions.map((entry, index) => {
            const item = workflow?.nodes.find((candidate) => candidate.id === entry.nodeId);
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
                      (entry.durationMs != null ? formatDuration(entry.durationMs) : entry.status)}
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
  onCopy,
  onEditNode,
}: {
  execution: NodeExecution;
  name: string;
  onCopy: (value: unknown) => void;
  onEditNode?: (nodeId: string) => void;
}) {
  return (
    <div className="node-execution-detail">
      <header>
        <div>
          <h3>{name}</h3>
          <Status status={execution.status} />
        </div>
        <div>
          <span>Duration <b>{execution.durationMs != null ? formatDuration(execution.durationMs) : "—"}</b></span>
          <span>Retries <b>{execution.retryCount}</b></span>
        </div>
      </header>
      {execution.error && (
        <div className="error-detail">
          <b>{execution.error.message}</b>
          {execution.error.detail && <p>{execution.error.detail}</p>}
          {execution.error.suggestion && <span>{execution.error.suggestion}</span>}
        </div>
      )}
      {execution.skipReason && (
        <div className="skip-detail">
          <b>Node skipped</b>
          <span>{execution.skipReason}</span>
          {execution.branchFollowed && <span>Followed the {execution.branchFollowed} branch.</span>}
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
      <Tabs.Root defaultValue="output">
        <Tabs.List className="detail-tabs">
          <Tabs.Trigger value="input">Input</Tabs.Trigger>
          <Tabs.Trigger value="output">Output</Tabs.Trigger>
          <Tabs.Trigger value="logs">Logs <em>{execution.logs.length}</em></Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="input"><CodeBlock value={execution.input} onCopy={onCopy} /></Tabs.Content>
        <Tabs.Content value="output"><CodeBlock value={execution.output} onCopy={onCopy} /></Tabs.Content>
        <Tabs.Content value="logs">
          <div className="logs">
            {execution.logs.length ? execution.logs.map((log, index) => (
              <div key={index}><span>{index + 1}</span>{log}</div>
            )) : <p>No logs were recorded for this node.</p>}
          </div>
        </Tabs.Content>
      </Tabs.Root>
    </div>
  );
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
  const successful = diagnostics.successfulLocator;
  const weak = diagnostics.locatorAttempts.some(attempt => attempt.succeeded && attempt.weakFallback);
  const openScreenshot = async () => {
    if (!diagnostics.screenshotPath) return;
    try {
      await api.openExecutionArtifact(diagnostics.screenshotPath);
    } catch (error) {
      alert(String(error));
    }
  };
  return (
    <section className="browser-diagnostics">
      <header>
        <span><LocateFixed size={14} />Browser evidence</span>
        <div>
          {diagnostics.screenshotPath && <button className="button" onClick={openScreenshot}><Image size={13} />Open screenshot</button>}
          {onEditNode && diagnostics.rerecordAvailable && <button className="button" onClick={() => onEditNode(nodeId)}><LocateFixed size={13} />Replace locator</button>}
          <button className="button" onClick={() => onCopy(diagnostics)}><Copy size={13} />Copy technical details</button>
        </div>
      </header>
      <div className="diagnostic-context">
        <span><small>Current URL</small><b>{diagnostics.currentUrl || "Unavailable"}</b></span>
        <span><small>Page title</small><b>{diagnostics.pageTitle || "Unavailable"}</b></span>
        <span><small>Matches</small><b>{diagnostics.matchCount}</b></span>
      </div>
      {diagnostics.playwrightError && <div className="diagnostic-warning"><AlertTriangle size={14} /><span><b>Playwright reported</b>{diagnostics.playwrightError}</span></div>}
      {weak && <div className="diagnostic-warning"><AlertTriangle size={14} /><span><b>Weak locator fallback used</b>The target matched only after stronger accessible locators failed.</span></div>}
      {diagnostics.unexpectedNavigation && <div className="diagnostic-warning"><AlertTriangle size={14} /><span><b>Unexpected navigation</b>The page navigated when this node did not declare a navigation.</span></div>}
      <details open={Boolean(diagnostics.locatorAttempts.length)}>
        <summary>Locator attempts ({diagnostics.locatorAttempts.length})</summary>
        <div className="locator-attempts">
          {diagnostics.locatorAttempts.length ? diagnostics.locatorAttempts.map((attempt, index) => (
            <div key={`${attempt.kind}-${index}`} className={attempt.succeeded ? "succeeded" : "failed"}>
              <span>{index + 1}</span><code>{attempt.kind}</code><b>{attempt.value}</b><em>{attempt.matchCount} match{attempt.matchCount === 1 ? "" : "es"}</em>
              {attempt.error && <small>{attempt.error}</small>}
            </div>
          )) : <p>No locator was required for this browser step.</p>}
        </div>
      </details>
      {successful && <p className="successful-locator">Succeeded with <code>{successful.kind}</code> · {successful.value}</p>}
      {(diagnostics.consoleErrors.length > 0 || diagnostics.failedNetworkRequests.length > 0) && (
        <details>
          <summary>Console and network evidence ({diagnostics.consoleErrors.length + diagnostics.failedNetworkRequests.length})</summary>
          <div className="diagnostic-errors">
            {diagnostics.consoleErrors.map((error, index) => <p key={`console-${index}`}><b>Console</b>{error}</p>)}
            {diagnostics.failedNetworkRequests.map((error, index) => <p key={`network-${index}`}><b>Network</b>{error}</p>)}
          </div>
        </details>
      )}
    </section>
  );
}

function CodeBlock({ value, onCopy }: { value: unknown; onCopy: (value: unknown) => void }) {
  return (
    <div className="code-block">
      <button onClick={() => onCopy(value)} title="Copy"><Clipboard size={13} /></button>
      <pre>{JSON.stringify(value, null, 2) ?? "null"}</pre>
    </div>
  );
}

const formatDuration = (ms: number) =>
  ms < 1000 ? `${ms} ms` : formatDistanceStrict(0, ms, { unit: ms < 60000 ? "second" : "minute" });
