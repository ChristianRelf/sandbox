import {
  AlertCircle,
  Info,
  ShieldAlert,
  TriangleAlert,
} from "lucide-react";
import { useState } from "react";
import {
  countIssues,
  createIssueReport,
  displayIssueCode,
  issueDocumentationUrl,
  type IssueLike,
  type IssueReportContext,
  type IssueTrackingRecord,
} from "../../issues";

const icons = {
  info: Info,
  warning: TriangleAlert,
  error: AlertCircle,
  permission: ShieldAlert,
};

const labels = {
  info: "Info",
  warning: "Warning",
  error: "Error",
  permission: "Permission required",
};

export function IssueNotice({
  issue,
  context,
  tracking,
  onFix,
  fixLabel = "Fix issue",
  compact = false,
}: {
  issue: IssueLike;
  context?: IssueReportContext;
  tracking?: IssueTrackingRecord;
  onFix?: () => void;
  fixLabel?: string;
  compact?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const Icon = icons[issue.severity];
  const code = displayIssueCode(issue.code, issue.severity);
  const copyReport = async () => {
    await navigator.clipboard.writeText(JSON.stringify(createIssueReport(issue, context, tracking), null, 2));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  return (
    <article className={`issue-notice issue-${issue.severity} ${compact ? "issue-compact" : ""}`} data-issue-code={code}>
      <Icon className="issue-icon" aria-hidden="true" size={compact ? 14 : 16} />
      <div className="issue-copy">
        <header>
          <span className="issue-level">{labels[issue.severity]}</span>
          <code>{code}</code>
        </header>
        <b>{issue.message}</b>
        {issue.suggestion && <p>{issue.suggestion}</p>}
        <footer>
          {onFix && <button type="button" className="issue-action" aria-label={issue.severity === "permission" ? `Permission required: ${fixLabel}` : undefined} onClick={onFix}>{fixLabel}</button>}
          <a href={issueDocumentationUrl(issue.severity)} target="_blank" rel="noreferrer">
            Learn more
          </a>
          <button type="button" className="issue-report" onClick={() => void copyReport()}>
            {copied ? "Copied" : "Copy report"}
          </button>
        </footer>
      </div>
    </article>
  );
}

export function IssueSummary({ issues }: { issues: IssueLike[] }) {
  const counts = countIssues(issues);
  return (
    <span className="issue-summary" aria-label={`${counts.error} errors, ${counts.warning} warnings, ${counts.info} information notices, ${counts.permission} permissions required`}>
      {counts.error > 0 && <span className="issue-summary-error">{counts.error} error{counts.error === 1 ? "" : "s"}</span>}
      {counts.warning > 0 && <span className="issue-summary-warning">{counts.warning} warning{counts.warning === 1 ? "" : "s"}</span>}
      {counts.info > 0 && <span className="issue-summary-info">{counts.info} info</span>}
      {counts.permission > 0 && <span className="issue-summary-permission">{counts.permission} permission{counts.permission === 1 ? "" : "s"}</span>}
    </span>
  );
}
