# Advanced flow and collections (Stage 2)

This document describes the implemented schema 6 collection contract shared by the desktop engine, self-hosted runner, and compatible hosted runner. The Rust engine is authoritative; the catalogue and editor configure that engine rather than simulating a second graph runtime.

## Runtime contract

A collection is an ordered `Vec<WorkflowItem>`. An item has a JSON-compatible `data` value and optional scoped binary/trusted-path references. Engine metadata records `itemId`, shared `originItemId`, immediate `parentItemId`, source node/index, original/current positions, branch and branch history, loop iteration, execution attempt, status, and downstream correlations.

An array inside `data` remains one value. Only Split Out expands an array into workflow items. Aggregate is the deliberate inverse. Merge's named inputs are distinct collections. An execution retry changes attempt evidence without changing the item's origin; a Switch all-match copy shares its origin ID.

Missing, JSON `null`, empty string, empty array, empty object, and a filtered item are different states. Equality is type-strict and object equality is canonicalised by sorted keys. Dates are RFC 3339 strings only.

Existing JSON-compatible outputs remain supported. The item envelope is maintained internally and in bounded execution evidence, so version 1 nodes do not need a breaking public output change.

## Graph and convergence

Control edges still determine eligibility. Input bindings still determine field data. Switch case IDs and Merge port IDs are stored independently from labels and positions. Ordinary nodes may not have ambiguous multiple incoming control edges; Merge must define convergence.

Routed collection outputs activate only the matching named handle. Empty branches remain measurable but do not run ordinary downstream work. Merge sees every configured input port and orders results by that configuration, never completion timing. Its failed and skipped input policies are explicit.

Loop Over Items uses an acyclic body region reached through `loop` and a separate `done` path. It does not recursively invoke the workflow. The body is evaluated once per deterministic batch with bounded concurrency. All reached terminal body endpoints contribute results in graph order.

## State, checkpoints, and recovery

Pure collection transforms can be recomputed. Cross-run deduplication writes a bounded canonical-key set through the existing pending workflow-state transaction; a failed workflow never commits new keys. Evidence exposes only a hash of a comparison key.

Each local loop iteration persists its immutable identity, batch hash, active/terminal status, attempt, and result in `loop_iteration_checkpoints`. A surviving `active` checkpoint identifies work that was in flight when execution was interrupted. Sequential iterations can see staged state from earlier completed iterations. Concurrent iterations start from the same pre-loop state snapshot to avoid timing-dependent reads.

Checkpoint evidence supports recovery decisions but does not claim exactly-once processing. The durable control plane's existing side-effect classification, completion checkpoint, idempotency-key, outcome-certainty, lease-loss, and operator-review rules remain authoritative for remote recovery. An uncertain mutation is never inferred successful from a missing response.

## Limits and stable failures

Default policy: 10,000 input items, 10,000 result items, 1 MiB per JSON item, 16 MiB aggregate output, 25,000 Cartesian results, 10,000 loop iterations, loop concurrency 16, 50,000 committed deduplication keys, and 100 history preview items. Workflow settings serialize these boundaries, and stricter runners reject incompatible configurations.

Limit errors use stable codes including `collection_input_item_limit`, `collection_result_item_limit`, `collection_item_size_limit`, `collection_aggregate_size_limit`, `collection_cartesian_limit`, `collection_loop_iteration_limit`, `collection_loop_concurrency_limit`, and `collection_deduplication_state_limit`.

History bounds do not truncate runtime values. Authoritative counts, failures, branch counts, and truncation flags remain visible. Deleting retained execution history also deletes its local loop checkpoints.

## Stage 3 foundation

Item identity is not scoped to a single node output shape and can be carried through a future workflow boundary. Stable named ports, branch history, origin/parent relationships, correlations, checkpoint status, and typed bindings can therefore support error outputs, external resume events, event batches, and sub-workflow item mapping without redesigning Loop or Merge.
