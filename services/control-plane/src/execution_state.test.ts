import { describe, expect, it } from "vitest";
import type { ExecutionCheckpoint, ExecutionTransition } from "@sandbox/contracts";
import { decideLeaseLossRecovery, validateExecutionTransition } from "./execution_state.js";

const transition = (overrides: Partial<ExecutionTransition> = {}): ExecutionTransition => ({
  transitionId: "10000000-0000-4000-8000-000000000001", executionId: "20000000-0000-4000-8000-000000000002",
  fromState: "running", toState: "succeeded", occurredAt: "2026-08-27T12:00:00.000Z",
  actor: { actorType: "runner", actorId: null, runnerId: "30000000-0000-4000-8000-000000000003" },
  reason: "Workflow completed.", expectedVersion: 4, leaseId: "40000000-0000-4000-8000-000000000004",
  correlationId: "50000000-0000-4000-8000-000000000005", metadata: {}, ...overrides
});

describe("durable execution state", () => {
  it("validates a leased transition and rejects duplicate/stale or terminal rewrites", () => {
    const current = { executionId: transition().executionId, state: "running" as const, version: 4, runnerId: transition().actor.runnerId, activeLeaseId: transition().leaseId, certainty: "certain" as const };
    expect(validateExecutionTransition(current, transition()).toState).toBe("succeeded");
    expect(() => validateExecutionTransition({ ...current, version: 5 }, transition())).toThrow(/updated by another actor/i);
    expect(() => validateExecutionTransition({ ...current, state: "succeeded" }, transition({ fromState: "succeeded", toState: "running" }))).toThrow(/cannot be rewritten/i);
  });

  it("rejects a runner without the current lease and prevents runners declaring themselves lost", () => {
    const current = { executionId: transition().executionId, state: "running" as const, version: 4, runnerId: transition().actor.runnerId, activeLeaseId: transition().leaseId, certainty: "certain" as const };
    expect(() => validateExecutionTransition(current, transition({ leaseId: "60000000-0000-4000-8000-000000000006" }))).toThrow(/lease/i);
    expect(() => validateExecutionTransition(current, transition({ toState: "lost" }))).toThrow(/control plane/i);
  });

  it("marks an interrupted unsafe side effect uncertain and blocks automatic replay", () => {
    const recovery = decideLeaseLossRecovery(null, { nodeId: "send-email", sideEffect: "unsafe", completionCheckpointExists: false, supportsIdempotency: false, idempotencyKey: null, explicitSafeRetry: false });
    expect(recovery).toMatchObject({ disposition: "review_required", certainty: "uncertain" });
  });

  it("resumes after a safe checkpoint and preserves an idempotency key", () => {
    const checkpoint: ExecutionCheckpoint = {
      checkpointId: "70000000-0000-4000-8000-000000000007", executionId: transition().executionId, workflowRevisionId: "80000000-0000-4000-8000-000000000008",
      nodeId: "transform", nodeVersion: 1, attempt: 1, status: "completed", inputHash: `sha256:${"a".repeat(64)}`, outputReference: "artifact://output",
      sideEffect: "none", idempotencyKey: null, completedAt: "2026-08-27T11:59:00.000Z", runnerId: transition().actor.runnerId!
    };
    const recovery = decideLeaseLossRecovery(checkpoint, { nodeId: "http", sideEffect: "idempotent", completionCheckpointExists: false, supportsIdempotency: true, idempotencyKey: "execution-node-attempt-0001", explicitSafeRetry: true });
    expect(recovery).toMatchObject({ disposition: "resume", certainty: "certain", checkpointId: checkpoint.checkpointId, preserveIdempotencyKey: true });
  });
});
