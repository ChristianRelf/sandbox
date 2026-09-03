import type { ExecutionError, ValidationIssue } from "./types";

export type IssueSeverity = "info" | "warning" | "error" | "permission";
export type IssueDisplayCode = `${"I" | "W" | "E" | "P"}#${string}`;

export interface IssueLike {
  code: string;
  message: string;
  severity: IssueSeverity;
  suggestion?: string;
  nodeId?: string;
  edgeId?: string;
  fieldPath?: string;
}

export interface IssueTrackingRecord {
  firstSeen: string;
  lastSeen: string;
  occurrences: number;
  resolvedAt?: string;
}

export interface IssueReportContext {
  workflowId?: string;
  executionId?: string;
  nodeId?: string;
  fieldPath?: string;
}

// This pipe-delimited registry is append-only. Position + 1 is the public
// number; never reorder or remove an entry.
const ISSUE_CODES = "aggregate_field_missing|aggregate_group_fields_missing|aggregate_operation_invalid|ambiguous_convergence|binding_field_missing|binding_self_reference|binding_source_missing|binding_source_unreachable|browser_operation_failed|browser_session_missing|cancelled|code_language_mismatch|code_network_denied|code_syntax|code_type_mismatch|collection_handle_invalid|condition_handle|cycle|dedupe_state_unavailable|disconnected_node|duplicate_edge|duplicate_node|environment_name_invalid|expression_invalid|expression_unreachable|expression_version_incompatible|filter_rules_missing|incomplete_node|loop_batch_size_invalid|loop_body_missing|loop_completion_missing|loop_concurrency_limit|loop_iteration_limit|loop_retry_limit|loop_unbounded|merge_binary_mode_inputs|merge_cartesian_limit|merge_cartesian_unbounded|merge_choice_invalid|merge_input_id_duplicate|merge_input_invalid|merge_inputs_missing|merge_join_key_missing|merge_mode_invalid|missing_endpoint|node_failed|node_test_failed|package_policy_rejected|permission_required|rule_regex_invalid|runner_error|runner_restarted|save_failed|self_connection|split_array_path_missing|split_array_schema_mismatch|storage_error|switch_branch_id_duplicate|switch_branch_id_invalid|switch_cases_missing|switch_fallback_invalid|switch_handle_invalid|trigger_count|trigger_input|trigger_mismatch|unsupported_schema|validation_unavailable|workflow_validation|external_communication_review|destructive_operation_review|restricted_code_execution|high_risk_capability|external_write_review|externally_visible_action|high_impact_external_write|collection_concurrency|cartesian_amplification|approval_impact|protected_input_required|plugin_permission_expansion|development_plugin|bounded_preview|browser_engine_diagnostic|weak_locator_fallback|unexpected_navigation|collection_state_review".split("|");

const PREFIX: Record<IssueSeverity, "I" | "W" | "E" | "P"> = {
  info: "I",
  warning: "W",
  error: "E",
  permission: "P",
};

export const ISSUE_DOCUMENTATION_URL = "https://docs.sndbox.app/troubleshooting/issues";

export function displayIssueCode(code: string, severity: IssueSeverity): IssueDisplayCode {
  const registered = ISSUE_CODES.indexOf(code) + 1;
  const number = severity === "permission" ? 1 : registered || fallbackNumber(code);
  return `${PREFIX[severity]}#${String(number).padStart(3, "0")}`;
}

export function issueDocumentationUrl(severity: IssueSeverity): string {
  return `${ISSUE_DOCUMENTATION_URL}#${severity === "permission" ? "permission-required" : "issue-codes"}`;
}

export function issueFingerprint(issue: Pick<IssueLike, "code" | "nodeId" | "edgeId" | "fieldPath">): string {
  return [issue.code, issue.nodeId, issue.edgeId, issue.fieldPath].filter(Boolean).join(":");
}

export function issuePriority(severity: IssueSeverity): number {
  return severity === "permission" ? 4 : severity === "error" ? 3 : severity === "warning" ? 2 : 1;
}

export function countIssues(issues: Array<Pick<IssueLike, "severity">>) {
  return issues.reduce(
    (counts, issue) => ({ ...counts, [issue.severity]: counts[issue.severity] + 1 }),
    { info: 0, warning: 0, error: 0, permission: 0 },
  );
}

export function executionErrorIssue(error: ExecutionError): IssueLike {
  const location = error.line != null
    ? `Line ${error.line}${error.column != null ? `, column ${error.column}` : ""}.`
    : undefined;
  return {
    code: error.code,
    message: error.message,
    severity: error.code === "permission_required" ? "permission" : "error",
    suggestion: [error.detail, error.suggestion, location].filter(Boolean).join(" ") || undefined,
  };
}

export function createIssueReport(
  issue: IssueLike,
  context: IssueReportContext = {},
  tracking?: IssueTrackingRecord,
) {
  return {
    issueCode: displayIssueCode(issue.code, issue.severity),
    internalCode: issue.code,
    severity: issue.severity,
    message: issue.message,
    suggestion: issue.suggestion,
    workflowId: context.workflowId,
    executionId: context.executionId,
    nodeId: context.nodeId ?? issue.nodeId,
    fieldPath: context.fieldPath ?? issue.fieldPath,
    firstSeen: tracking?.firstSeen,
    lastSeen: tracking?.lastSeen,
    occurrences: tracking?.occurrences,
    reportedAt: new Date().toISOString(),
  };
}

export function asIssue(issue: ValidationIssue): IssueLike {
  return issue;
}

function fallbackNumber(code: string): number {
  let hash = 2166136261;
  for (const character of code) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return 900 + ((hash >>> 0) % 100);
}
