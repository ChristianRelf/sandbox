import type { ExecutionCheckpoint, ExecutionRecovery, ExecutionState, ExecutionTransition, SideEffectClassification } from "@sandbox/contracts";
import { executionTransitionSchema } from "@sandbox/contracts";
import { DomainError } from "./types.js";

const terminalStates = new Set<ExecutionState>(["succeeded", "failed", "timed_out", "skipped", "cancelled", "expired"]);

const transitions: Readonly<Record<ExecutionState, ReadonlySet<ExecutionState>>> = {
  queued: new Set(["waiting_for_runner", "cancelling", "skipped", "cancelled", "expired"]),
  waiting_for_runner: new Set(["claimed", "cancelling", "skipped", "cancelled", "expired"]),
  claimed: new Set(["starting", "waiting_for_runner", "cancelling", "lost", "expired"]),
  starting: new Set(["running", "waiting_for_approval", "retrying", "cancelling", "failed", "timed_out", "lost"]),
  running: new Set(["waiting_for_approval", "retrying", "cancelling", "succeeded", "failed", "timed_out", "lost"]),
  waiting_for_approval: new Set(["running", "retrying", "cancelling", "failed", "cancelled", "expired", "lost"]),
  retrying: new Set(["waiting_for_runner", "claimed", "starting", "running", "cancelling", "failed", "timed_out", "lost", "expired"]),
  cancelling: new Set(["cancelled", "failed", "timed_out", "lost"]),
  succeeded: new Set(),
  failed: new Set(),
  timed_out: new Set(),
  skipped: new Set(),
  cancelled: new Set(),
  lost: new Set(["waiting_for_runner", "retrying", "failed", "cancelled", "expired"]),
  expired: new Set()
};

export interface ExecutionProjection {
  executionId: string;
  state: ExecutionState;
  version: number;
  runnerId: string | null;
  activeLeaseId: string | null;
  certainty: "certain" | "uncertain";
}

export function isTerminalExecutionState(state: ExecutionState): boolean {
  return terminalStates.has(state);
}

export function validateExecutionTransition(current: ExecutionProjection, candidate: unknown): ExecutionTransition {
  const event = executionTransitionSchema.parse(candidate);
  if (event.executionId !== current.executionId) throw new DomainError("execution_transition_target_mismatch", "Transition targets another execution.", 409);
  if (event.expectedVersion !== current.version) throw new DomainError("execution_transition_version_conflict", "Execution was updated by another actor.", 409);
  if (event.fromState !== current.state) throw new DomainError("execution_transition_state_conflict", `Execution is ${current.state}, not ${event.fromState}.`, 409);
  if (isTerminalExecutionState(current.state)) throw new DomainError("execution_terminal", `Completed execution state ${current.state} cannot be rewritten.`, 409);
  if (!transitions[current.state].has(event.toState)) throw new DomainError("execution_transition_invalid", `Transition ${current.state} -> ${event.toState} is not allowed.`, 409);
  if (event.actor.actorType === "runner") {
    if (current.runnerId !== event.actor.runnerId) throw new DomainError("execution_runner_mismatch", "Runner does not own this execution.", 403);
    if (current.activeLeaseId === null || event.leaseId !== current.activeLeaseId) throw new DomainError("execution_lease_invalid", "A current execution lease is required.", 409);
  }
  if (event.toState === "lost" && event.actor.actorType === "runner") throw new DomainError("execution_lost_system_only", "Only the control plane can mark a lease as lost.", 403);
  return event;
}

export interface InterruptedNode {
  nodeId: string;
  sideEffect: SideEffectClassification;
  completionCheckpointExists: boolean;
  supportsIdempotency: boolean;
  idempotencyKey: string | null;
  explicitSafeRetry: boolean;
}

export function decideLeaseLossRecovery(lastCheckpoint: ExecutionCheckpoint | null, interruptedNode: InterruptedNode | null): ExecutionRecovery {
  if (interruptedNode && !interruptedNode.completionCheckpointExists) {
    const retryable = interruptedNode.sideEffect === "none" || interruptedNode.sideEffect === "safe_retry" || (interruptedNode.sideEffect === "idempotent" && interruptedNode.supportsIdempotency && interruptedNode.idempotencyKey !== null);
    if (!retryable || interruptedNode.sideEffect === "unsafe" || interruptedNode.sideEffect === "unknown") {
      return {
        disposition: "review_required", certainty: "uncertain", checkpointId: lastCheckpoint?.checkpointId ?? null,
        resumeAfterNodeId: lastCheckpoint?.nodeId ?? null,
        reason: `Runner connection was lost while ${interruptedNode.nodeId} may have produced an external side effect. Automatic replay is blocked.`,
        preserveIdempotencyKey: interruptedNode.idempotencyKey !== null
      };
    }
    if (!interruptedNode.explicitSafeRetry && interruptedNode.sideEffect !== "none" && interruptedNode.sideEffect !== "idempotent") {
      return {
        disposition: "review_required", certainty: "uncertain", checkpointId: lastCheckpoint?.checkpointId ?? null,
        resumeAfterNodeId: lastCheckpoint?.nodeId ?? null,
        reason: `Node ${interruptedNode.nodeId} has no explicit safe retry policy.`, preserveIdempotencyKey: interruptedNode.idempotencyKey !== null
      };
    }
  }
  if (lastCheckpoint) {
    return {
      disposition: "resume", certainty: "certain", checkpointId: lastCheckpoint.checkpointId, resumeAfterNodeId: lastCheckpoint.nodeId,
      reason: `Resume after durable checkpoint ${lastCheckpoint.nodeId}.`, preserveIdempotencyKey: interruptedNode?.idempotencyKey !== null && interruptedNode?.idempotencyKey !== undefined
    };
  }
  return { disposition: "restart", certainty: "certain", checkpointId: null, resumeAfterNodeId: null, reason: "No completed node checkpoint exists; restart from the beginning.", preserveIdempotencyKey: false };
}
