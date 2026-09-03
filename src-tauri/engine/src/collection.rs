use crate::{CollectionEvidence, CollectionLimits, EngineError, WorkflowItem};
use chrono::{DateTime, Utc};
use regex::Regex;
use serde_json::{json, Map, Number, Value};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashMap, HashSet};

pub const COLLECTION_NODE_TYPES: &[&str] = &[
    "filter",
    "switch",
    "split_out",
    "loop_over_items",
    "aggregate",
    "remove_duplicates",
    "merge",
];

#[derive(Debug)]
pub struct CollectionNodeResult {
    pub output: Value,
    pub output_items: Vec<WorkflowItem>,
    pub branch_outputs: BTreeMap<String, Vec<WorkflowItem>>,
    pub evidence: CollectionEvidence,
    pub state_update: Option<(String, Value)>,
    pub logs: Vec<String>,
    pub warnings: Vec<String>,
}

impl CollectionNodeResult {
    fn from_items(
        items: Vec<WorkflowItem>,
        input_count: usize,
        ordering: &str,
        limits: &CollectionLimits,
    ) -> Self {
        let evidence = evidence(&items, input_count, 0, ordering, limits);
        Self {
            output: items_output(&items),
            output_items: items,
            branch_outputs: BTreeMap::new(),
            evidence,
            state_update: None,
            logs: vec![],
            warnings: vec![],
        }
    }
}

pub fn execute_collection_node(
    node_type: &str,
    node_id: &str,
    config: &Value,
    mut inputs: Vec<WorkflowItem>,
    named_inputs: BTreeMap<String, Vec<WorkflowItem>>,
    limits: &CollectionLimits,
    stored_dedupe_state: Option<Value>,
) -> Result<CollectionNodeResult, EngineError> {
    normalize_input_identities(node_id, &mut inputs);
    enforce_input_limits(&inputs, limits)?;
    let mut result = match node_type {
        "filter" => execute_filter(config, inputs, limits),
        "switch" => execute_switch(config, inputs, limits),
        "split_out" => execute_split_out(config, inputs, limits),
        "loop_over_items" => execute_loop(config, inputs, limits),
        "aggregate" => execute_aggregate(config, inputs, limits),
        "remove_duplicates" => execute_dedupe(node_id, config, inputs, limits, stored_dedupe_state),
        "merge" => execute_merge(config, named_inputs, limits),
        _ => Err(EngineError::Node(format!(
            "Collection node '{node_type}' is not supported."
        ))),
    }?;
    for item in &mut result.output_items {
        item.source_node_id = Some(node_id.into());
    }
    for items in result.branch_outputs.values_mut() {
        for item in items {
            item.source_node_id = Some(node_id.into());
        }
    }
    if let Some(object) = result.output.as_object_mut() {
        object.insert("items".into(), json!(result.output_items));
        if !result.branch_outputs.is_empty() {
            object.insert(
                "branches".into(),
                Value::Object(
                    result
                        .branch_outputs
                        .iter()
                        .map(|(branch, items)| (branch.clone(), json!({"items":items})))
                        .collect(),
                ),
            );
        }
    }
    result.evidence.sample_items = result
        .evidence
        .sample_items
        .into_iter()
        .map(|mut item| {
            item.source_node_id = Some(node_id.into());
            item
        })
        .collect();
    Ok(result)
}

fn execute_filter(
    config: &Value,
    inputs: Vec<WorkflowItem>,
    limits: &CollectionLimits,
) -> Result<CollectionNodeResult, EngineError> {
    let mut retained = Vec::new();
    let mut rejected = Vec::new();
    let remove_matches = config.get("mode").and_then(Value::as_str) == Some("remove_matches");
    for mut item in inputs {
        let matched = evaluate_rule_group(config, &item.data)?;
        attach_rule_evidence(config, &mut item)?;
        let keep = if remove_matches { !matched } else { matched };
        item.status = if keep { "successful" } else { "filtered" }.into();
        item.branch = Some(if keep { "output" } else { "rejected" }.into());
        item.branch_history.push(item.branch.clone().unwrap());
        if keep {
            retained.push(item);
        } else {
            rejected.push(item);
        }
    }
    set_positions(&mut retained);
    set_positions(&mut rejected);
    enforce_result_limits(&retained, limits)?;
    let input_count = retained.len() + rejected.len();
    let mut result = CollectionNodeResult::from_items(retained, input_count, "input_order", limits);
    result.evidence.rejected_item_count = rejected.len();
    result
        .evidence
        .branch_counts
        .insert("output".into(), result.output_items.len());
    result
        .evidence
        .branch_counts
        .insert("rejected".into(), rejected.len());
    let mut samples = result.output_items.clone();
    samples.extend(rejected.clone());
    set_evidence_samples(&mut result.evidence, &samples, limits);
    result
        .branch_outputs
        .insert("output".into(), result.output_items.clone());
    if config
        .get("exposeRejected")
        .and_then(Value::as_bool)
        .unwrap_or(true)
    {
        result.branch_outputs.insert("rejected".into(), rejected);
    }
    result.output = output_with_branches(&result.output_items, &result.branch_outputs);
    result.logs.push(format!(
        "Filter received {input_count} item(s), retained {} and removed {}.",
        result.output_items.len(),
        result.evidence.rejected_item_count
    ));
    Ok(result)
}

fn execute_switch(
    config: &Value,
    inputs: Vec<WorkflowItem>,
    limits: &CollectionLimits,
) -> Result<CollectionNodeResult, EngineError> {
    let cases = config
        .get("cases")
        .and_then(Value::as_array)
        .ok_or_else(|| EngineError::Node("Switch requires at least one case.".into()))?;
    if cases.is_empty() {
        return Err(EngineError::Node(
            "Switch requires at least one case.".into(),
        ));
    }
    let all_matches = config.get("mode").and_then(Value::as_str) == Some("all_matches");
    let fallback = config
        .get("fallbackBranchId")
        .and_then(Value::as_str)
        .unwrap_or("fallback");
    let route_path = config
        .get("valuePath")
        .and_then(Value::as_str)
        .unwrap_or("");
    let exact_mode = config.get("routingMode").and_then(Value::as_str) == Some("value");
    let mut branch_order = cases
        .iter()
        .filter_map(|case| case.get("id").and_then(Value::as_str).map(str::to_string))
        .collect::<Vec<_>>();
    branch_order.push(fallback.into());
    let mut branches: BTreeMap<String, Vec<WorkflowItem>> = cases
        .iter()
        .filter_map(|case| {
            case.get("id")
                .and_then(Value::as_str)
                .map(|id| (id.to_string(), vec![]))
        })
        .collect();
    branches.entry(fallback.into()).or_default();
    let mut unmatched = 0;
    let mut copied = 0;
    for item in inputs {
        let mut matched_ids = Vec::new();
        for case in cases {
            let id = case.get("id").and_then(Value::as_str).ok_or_else(|| {
                EngineError::Node("Every Switch case requires a stable id.".into())
            })?;
            let matched = if exact_mode {
                let actual = lookup_path(&item.data, route_path);
                actual.is_present_and(|value| {
                    strict_equal(value, case.get("value").unwrap_or(&Value::Null))
                })
            } else {
                evaluate_rule_group(case, &item.data)?
            };
            if matched {
                matched_ids.push(id.to_string());
                if !all_matches {
                    break;
                }
            }
        }
        let was_unmatched = matched_ids.is_empty();
        if was_unmatched {
            matched_ids.push(fallback.into());
            unmatched += 1;
        }
        if matched_ids.len() > 1 {
            copied += matched_ids.len() - 1;
        }
        for branch_id in matched_ids {
            let mut routed = item.clone();
            if was_unmatched {
                routed.status = "unmatched".into();
            }
            if routed.origin_item_id.is_none() {
                routed.origin_item_id = Some(routed.item_id.clone());
            }
            routed
                .correlations
                .insert("matchedCase".into(), branch_id.clone());
            if exact_mode {
                routed.correlations.insert(
                    "resolvedRouteType".into(),
                    lookup_path(&routed.data, route_path).type_name().into(),
                );
            }
            routed.item_id = format!("{}@{}", routed.item_id, branch_id);
            routed.branch = Some(branch_id.clone());
            routed.branch_history.push(branch_id.clone());
            branches.entry(branch_id).or_default().push(routed);
        }
    }
    let mut all = Vec::new();
    for branch_id in branch_order {
        if let Some(items) = branches.get_mut(&branch_id) {
            set_positions(items);
            all.extend(items.clone());
        }
    }
    set_positions(&mut all);
    enforce_result_limits(&all, limits)?;
    let input_count = all.len().saturating_sub(copied);
    let mut result = CollectionNodeResult::from_items(
        all,
        input_count,
        if all_matches {
            "case_order_then_input_order"
        } else {
            "input_order"
        },
        limits,
    );
    result.branch_outputs = branches;
    result.evidence.branch_counts = result
        .branch_outputs
        .iter()
        .map(|(k, v)| (k.clone(), v.len()))
        .collect();
    result.evidence.rejected_item_count = unmatched;
    result.output = output_with_branches(&result.output_items, &result.branch_outputs);
    result.logs.push(format!("Switch routed {input_count} item(s); {unmatched} used fallback and {copied} additional branch copy/copies were produced."));
    Ok(result)
}

fn execute_split_out(
    config: &Value,
    inputs: Vec<WorkflowItem>,
    limits: &CollectionLimits,
) -> Result<CollectionNodeResult, EngineError> {
    let path = config
        .get("fieldPath")
        .and_then(Value::as_str)
        .unwrap_or("");
    let property = config
        .get("destinationField")
        .and_then(Value::as_str)
        .unwrap_or("item");
    let keep_all = config
        .get("keepParentFields")
        .and_then(Value::as_bool)
        .unwrap_or(true);
    let keep_original = config
        .get("keepOriginalArray")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let include_index = config
        .get("includeIndex")
        .and_then(Value::as_bool)
        .unwrap_or(true);
    let invalid_policy = config
        .get("invalidInputPolicy")
        .and_then(Value::as_str)
        .unwrap_or("fail");
    let empty_policy = config
        .get("emptyArrayPolicy")
        .and_then(Value::as_str)
        .unwrap_or("emit_no_items");
    let mut output = Vec::new();
    let mut rejected = Vec::new();
    for (parent_index, parent) in inputs.iter().enumerate() {
        let selected = if path.is_empty() {
            PathValue::Present(&parent.data)
        } else {
            lookup_path(&parent.data, path)
        };
        let values = match selected {
            PathValue::Present(Value::Array(values)) => values,
            PathValue::Missing => {
                if invalid_policy == "emit_no_items" {
                    continue;
                }
                if invalid_policy == "rejected" {
                    let mut rejected_item = parent.clone();
                    rejected_item.status = "failed".into();
                    rejected.push(rejected_item);
                    continue;
                }
                return Err(EngineError::Node(format!(
                    "Split Out could not find array field '{path}' on input item {parent_index}."
                )));
            }
            PathValue::Present(_) => {
                if invalid_policy == "emit_no_items" {
                    continue;
                }
                if invalid_policy == "rejected" {
                    let mut rejected_item = parent.clone();
                    rejected_item.status = "failed".into();
                    rejected.push(rejected_item);
                    continue;
                }
                return Err(EngineError::Node(format!(
                    "Split Out expected '{path}' to be an array on input item {parent_index}."
                )));
            }
        };
        if values.is_empty() {
            match empty_policy {
                "keep_parent" => output.push(parent.clone()),
                "fail" => {
                    return Err(EngineError::Node(format!(
                        "Split Out received an empty array on input item {parent_index}."
                    )))
                }
                _ => {}
            }
        }
        for (array_index, value) in values.iter().enumerate() {
            let mut data = if keep_all {
                parent.data.clone()
            } else {
                json!({})
            };
            if path.is_empty() && !keep_all {
                data = value.clone();
            } else {
                if !keep_original && !path.is_empty() {
                    remove_path(&mut data, path);
                }
                insert_path(&mut data, property, value.clone())?;
                if include_index {
                    insert_path(&mut data, "originalItemIndex", json!(array_index))?;
                }
            }
            let parent_id = if parent.item_id.is_empty() {
                format!("parent:{parent_index}")
            } else {
                parent.item_id.clone()
            };
            let mut child = parent.clone();
            child.data = data;
            child.parent_item_id = Some(parent_id.clone());
            child.origin_item_id = parent.origin_item_id.clone().or(Some(parent_id.clone()));
            child.item_id = format!("{parent_id}/split:{array_index}");
            child.source_item_index = Some(array_index);
            child.original_position = Some(array_index);
            child.branch = Some("output".into());
            child.branch_history.push("output".into());
            output.push(child);
        }
    }
    set_positions(&mut output);
    set_positions(&mut rejected);
    enforce_result_limits(&output, limits)?;
    let input_count = inputs.len();
    let mut result = CollectionNodeResult::from_items(
        output,
        input_count,
        "parent_order_then_array_order",
        limits,
    );
    result.evidence.rejected_item_count = rejected.len();
    let mut samples = result.output_items.clone();
    samples.extend(rejected.clone());
    set_evidence_samples(&mut result.evidence, &samples, limits);
    result
        .branch_outputs
        .insert("output".into(), result.output_items.clone());
    result.branch_outputs.insert("rejected".into(), rejected);
    result.evidence.branch_counts = result
        .branch_outputs
        .iter()
        .map(|(k, v)| (k.clone(), v.len()))
        .collect();
    result.output = output_with_branches(&result.output_items, &result.branch_outputs);
    result.logs.push(format!(
        "Split Out expanded {input_count} parent item(s) into {} item(s).",
        result.output_items.len()
    ));
    Ok(result)
}

fn execute_loop(
    config: &Value,
    mut inputs: Vec<WorkflowItem>,
    limits: &CollectionLimits,
) -> Result<CollectionNodeResult, EngineError> {
    let batch_size = config
        .get("batchSize")
        .and_then(Value::as_u64)
        .unwrap_or(1)
        .max(1) as usize;
    let concurrency = config
        .get("concurrency")
        .and_then(Value::as_u64)
        .unwrap_or(1)
        .max(1) as usize;
    let configured_max = config
        .get("maxIterations")
        .and_then(Value::as_u64)
        .unwrap_or(limits.max_loop_iterations as u64) as usize;
    let maximum = configured_max.min(limits.max_loop_iterations);
    if concurrency > limits.max_loop_concurrency {
        return limit_error(
            "collection_loop_concurrency_limit",
            format!(
                "Loop concurrency {concurrency} exceeds runner limit {}.",
                limits.max_loop_concurrency
            ),
        );
    }
    let iterations = inputs.len().div_ceil(batch_size);
    if iterations > maximum {
        return limit_error(
            "collection_loop_iteration_limit",
            format!("Loop requires {iterations} iterations, exceeding configured limit {maximum}."),
        );
    }
    for (index, item) in inputs.iter_mut().enumerate() {
        item.loop_iteration = Some(index / batch_size);
        item.branch = Some("loop".into());
        item.branch_history.push("loop".into());
        item.correlations.insert(
            "iterationId".into(),
            format!("iteration-{:08}", index / batch_size),
        );
    }
    let mut result = CollectionNodeResult::from_items(
        inputs,
        iterations.saturating_mul(batch_size),
        if concurrency == 1 {
            "stable_input_order"
        } else {
            "iteration_order; body completion may differ"
        },
        limits,
    );
    result.evidence.input_item_count = result.output_items.len();
    result.evidence.iteration_count = iterations;
    result.evidence.batch_count = iterations;
    result
        .evidence
        .branch_counts
        .insert("loop".into(), result.output_items.len());
    result
        .evidence
        .branch_counts
        .insert("done".into(), result.output_items.len());
    result
        .branch_outputs
        .insert("loop".into(), result.output_items.clone());
    result
        .branch_outputs
        .insert("done".into(), result.output_items.clone());
    result.output = output_with_branches(&result.output_items, &result.branch_outputs);
    if concurrency > 1 {
        result.warnings.push("Concurrent loop bodies may finish out of order. Side-effecting body nodes require idempotency and ordering review.".into());
    }
    result.logs.push(format!("Prepared {} item(s) as {iterations} deterministic batch(es), batch size {batch_size}, concurrency {concurrency}.", result.output_items.len()));
    Ok(result)
}

fn execute_aggregate(
    config: &Value,
    inputs: Vec<WorkflowItem>,
    limits: &CollectionLimits,
) -> Result<CollectionNodeResult, EngineError> {
    let operation = config
        .get("operation")
        .and_then(Value::as_str)
        .unwrap_or("collect_items");
    let field = config
        .get("fieldPath")
        .and_then(Value::as_str)
        .unwrap_or("");
    let include_missing = config
        .get("includeMissing")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let values: Vec<Value> = inputs
        .iter()
        .filter_map(|item| match lookup_path(&item.data, field) {
            PathValue::Present(value) => Some(value.clone()),
            PathValue::Missing if include_missing => Some(Value::Null),
            _ => None,
        })
        .collect();
    let data = match operation {
        "collect_items" => Value::Array(inputs.iter().map(|item| item.data.clone()).collect()),
        "collect_field" => Value::Array(values),
        "count" => json!(inputs.len()),
        "sum" | "minimum" | "maximum" | "average" => numeric_aggregate(operation, &values)?,
        "first" => values.first().cloned().unwrap_or(Value::Null),
        "last" => values.last().cloned().unwrap_or(Value::Null),
        "concatenate" => Value::String(
            values
                .iter()
                .map(|v| {
                    v.as_str().ok_or_else(|| {
                        EngineError::Node("Concatenate requires string values.".into())
                    })
                })
                .collect::<Result<Vec<_>, _>>()?
                .join(
                    config
                        .get("separator")
                        .and_then(Value::as_str)
                        .unwrap_or(","),
                ),
        ),
        "group_by" => group_by(config, &inputs),
        "object_by_key" => object_by_key(config, &inputs)?,
        other => {
            return Err(EngineError::Node(format!(
                "Aggregate operation '{other}' is not supported."
            )))
        }
    };
    let size = serde_json::to_vec(&data)
        .map_err(|e| EngineError::Node(e.to_string()))?
        .len();
    if size > limits.max_aggregate_bytes {
        return limit_error(
            "collection_aggregate_size_limit",
            format!(
                "Aggregate result is {size} bytes, exceeding runner limit {} bytes.",
                limits.max_aggregate_bytes
            ),
        );
    }
    let mut item = WorkflowItem::json(data.clone());
    item.item_id = "aggregate:0".into();
    item.original_position = Some(0);
    item.current_position = Some(0);
    item.correlations
        .insert("sourceItemCount".into(), inputs.len().to_string());
    if config
        .get("preserveLineage")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        for (index, source) in inputs
            .iter()
            .take(limits.max_history_item_previews)
            .enumerate()
        {
            item.correlations
                .insert(format!("source:{index}"), source.item_id.clone());
        }
        if inputs.len() > limits.max_history_item_previews {
            item.correlations
                .insert("sourceLineageTruncated".into(), "true".into());
        }
    }
    let mut result =
        CollectionNodeResult::from_items(vec![item], inputs.len(), "input_order", limits);
    result.output = json!({"value":data,"items":result.output_items});
    result.logs.push(format!(
        "Aggregate '{operation}' reduced {} item(s) to one result.",
        inputs.len()
    ));
    Ok(result)
}

fn execute_dedupe(
    node_id: &str,
    config: &Value,
    inputs: Vec<WorkflowItem>,
    limits: &CollectionLimits,
    stored: Option<Value>,
) -> Result<CollectionNodeResult, EngineError> {
    let keep_last = config.get("keep").and_then(Value::as_str) == Some("last");
    let mode = config
        .get("scope")
        .and_then(Value::as_str)
        .unwrap_or("collection");
    let mut seen: HashSet<String> = if mode == "workflow_state" {
        stored
            .as_ref()
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .map(str::to_string)
            .collect()
    } else {
        HashSet::new()
    };
    let before = seen.clone();
    let mut unique = Vec::new();
    let mut duplicate = Vec::new();
    let iterator: Box<dyn Iterator<Item = WorkflowItem>> = if keep_last {
        Box::new(inputs.into_iter().rev())
    } else {
        Box::new(inputs.into_iter())
    };
    for mut item in iterator {
        let key = dedupe_key(config, &item)?;
        item.correlations.insert(
            "dedupeKeyHash".into(),
            format!("sha256:{:x}", Sha256::digest(key.as_bytes())),
        );
        if seen.insert(key) {
            unique.push(item);
        } else {
            item.status = "removed".into();
            duplicate.push(item);
        }
    }
    if keep_last {
        unique.reverse();
        duplicate.reverse();
    }
    set_positions(&mut unique);
    set_positions(&mut duplicate);
    enforce_result_limits(&unique, limits)?;
    let input_count = unique.len() + duplicate.len();
    let mut result = CollectionNodeResult::from_items(unique, input_count, "input_order", limits);
    result.evidence.rejected_item_count = duplicate.len();
    let mut samples = result.output_items.clone();
    samples.extend(duplicate.clone());
    set_evidence_samples(&mut result.evidence, &samples, limits);
    result
        .branch_outputs
        .insert("output".into(), result.output_items.clone());
    if config
        .get("exposeDuplicates")
        .and_then(Value::as_bool)
        .unwrap_or(true)
    {
        result.branch_outputs.insert("duplicates".into(), duplicate);
    }
    result.evidence.branch_counts = result
        .branch_outputs
        .iter()
        .map(|(k, v)| (k.clone(), v.len()))
        .collect();
    result.output = output_with_branches(&result.output_items, &result.branch_outputs);
    if mode == "workflow_state" {
        if seen.len() > limits.max_deduplication_keys {
            return limit_error(
                "collection_deduplication_state_limit",
                format!(
                    "Cross-run deduplication would retain {} keys, exceeding runner limit {}.",
                    seen.len(),
                    limits.max_deduplication_keys
                ),
            );
        }
        let mut keys = seen.into_iter().collect::<Vec<_>>();
        keys.sort();
        result.state_update = Some((
            format!("__stage2_dedupe:{node_id}"),
            Value::Array(keys.into_iter().map(Value::String).collect()),
        ));
        result.logs.push(format!("Cross-run deduplication compared against {} committed key(s); new keys remain staged until workflow success.",before.len()));
    }
    result.logs.push(format!(
        "Remove Duplicates retained {} of {input_count} item(s).",
        result.output_items.len()
    ));
    Ok(result)
}

fn execute_merge(
    config: &Value,
    mut ports: BTreeMap<String, Vec<WorkflowItem>>,
    limits: &CollectionLimits,
) -> Result<CollectionNodeResult, EngineError> {
    for (port, items) in &mut ports {
        normalize_input_identities(port, items);
        enforce_input_limits(items, limits)?;
    }
    let input_count = ports.values().map(Vec::len).sum();
    let mode = config
        .get("mode")
        .and_then(Value::as_str)
        .unwrap_or("wait_all");
    let ordered_ports = config
        .get("inputPorts")
        .and_then(Value::as_array)
        .map(|v| {
            v.iter()
                .filter_map(|v| v.get("id").and_then(Value::as_str).map(str::to_string))
                .collect::<Vec<_>>()
        })
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| ports.keys().cloned().collect());
    let mut result_items = match mode {
        "wait_all" => vec![wait_all_item(&ordered_ports, &ports)],
        "append" => ordered_ports
            .iter()
            .flat_map(|port| ports.get(port).cloned().unwrap_or_default())
            .collect(),
        "combine_position" => combine_position(config, &ordered_ports, &ports)?,
        "combine_fields" => combine_fields(config, &ordered_ports, &ports, limits)?,
        "cartesian" => cartesian(config, &ordered_ports, &ports, limits)?,
        "choose_branch" => choose_branch(config, &ordered_ports, &ports),
        other => {
            return Err(EngineError::Node(format!(
                "Merge mode '{other}' is not supported."
            )))
        }
    };
    set_positions(&mut result_items);
    enforce_result_limits(&result_items, limits)?;
    let mut result = CollectionNodeResult::from_items(
        result_items,
        input_count,
        "configured_input_port_order",
        limits,
    );
    result.evidence.branch_counts = ports.iter().map(|(k, v)| (k.clone(), v.len())).collect();
    result.logs.push(format!(
        "Merge '{mode}' combined {input_count} item(s) from {} named input(s) into {} item(s).",
        ports.len(),
        result.output_items.len()
    ));
    Ok(result)
}

fn combine_position(
    config: &Value,
    ordered: &[String],
    ports: &BTreeMap<String, Vec<WorkflowItem>>,
) -> Result<Vec<WorkflowItem>, EngineError> {
    let max = ordered
        .iter()
        .map(|p| ports.get(p).map(Vec::len).unwrap_or(0))
        .max()
        .unwrap_or(0);
    let min = ordered
        .iter()
        .map(|p| ports.get(p).map(Vec::len).unwrap_or(0))
        .min()
        .unwrap_or(0);
    let mismatch = config
        .get("unmatchedPolicy")
        .and_then(Value::as_str)
        .unwrap_or("keep");
    if mismatch == "fail" && max != min {
        return Err(EngineError::Node(
            "Merge by position received inputs with different lengths.".into(),
        ));
    }
    let count = if mismatch == "drop" { min } else { max };
    (0..count)
        .map(|index| {
            merge_items(
                config,
                ordered.iter().filter_map(|p| {
                    ports
                        .get(p)
                        .and_then(|v| v.get(index))
                        .map(|i| (p.as_str(), i))
                }),
            )
        })
        .collect()
}

fn combine_fields(
    config: &Value,
    ordered: &[String],
    ports: &BTreeMap<String, Vec<WorkflowItem>>,
    limits: &CollectionLimits,
) -> Result<Vec<WorkflowItem>, EngineError> {
    if ordered.len() != 2 {
        return Err(EngineError::Node(
            "Merge by matching fields currently requires exactly two named inputs.".into(),
        ));
    }
    let left = ports.get(&ordered[0]).map(Vec::as_slice).unwrap_or(&[]);
    let right = ports.get(&ordered[1]).map(Vec::as_slice).unwrap_or(&[]);
    let left_key = config
        .get("leftKey")
        .and_then(Value::as_str)
        .unwrap_or("id");
    let right_key = config
        .get("rightKey")
        .and_then(Value::as_str)
        .unwrap_or("id");
    let join = config
        .get("join")
        .and_then(Value::as_str)
        .unwrap_or("inner");
    let mut right_map: HashMap<String, Vec<(usize, &WorkflowItem)>> = HashMap::new();
    for (i, item) in right.iter().enumerate() {
        if let PathValue::Present(v) = lookup_path(&item.data, right_key) {
            right_map.entry(canonical(v)).or_default().push((i, item));
        }
    }
    let mut matched_right = HashSet::new();
    let mut out = Vec::new();
    for left_item in left {
        let matches = match lookup_path(&left_item.data, left_key) {
            PathValue::Present(v) => right_map.get(&canonical(v)),
            PathValue::Missing => None,
        };
        if let Some(matches) = matches {
            for (ri, right_item) in matches {
                matched_right.insert(*ri);
                out.push(merge_items(
                    config,
                    [
                        (ordered[0].as_str(), left_item),
                        (ordered[1].as_str(), *right_item),
                    ]
                    .into_iter(),
                )?);
            }
        } else if matches!(join, "left" | "full") {
            out.push(merge_items(
                config,
                [(ordered[0].as_str(), left_item)].into_iter(),
            )?);
        }
        if out.len() > limits.max_result_items {
            return limit_error(
                "collection_result_item_limit",
                format!(
                    "Merge join exceeded runner result limit {}.",
                    limits.max_result_items
                ),
            );
        }
    }
    if matches!(join, "right" | "full") {
        for (_ri, item) in right
            .iter()
            .enumerate()
            .filter(|(i, _)| !matched_right.contains(i))
        {
            out.push(merge_items(
                config,
                [(ordered[1].as_str(), item)].into_iter(),
            )?);
        }
    }
    Ok(out)
}

fn cartesian(
    config: &Value,
    ordered: &[String],
    ports: &BTreeMap<String, Vec<WorkflowItem>>,
    limits: &CollectionLimits,
) -> Result<Vec<WorkflowItem>, EngineError> {
    if ordered.len() != 2 {
        return Err(EngineError::Node(
            "Cartesian Merge requires exactly two inputs.".into(),
        ));
    }
    let a = ports.get(&ordered[0]).map(Vec::as_slice).unwrap_or(&[]);
    let b = ports.get(&ordered[1]).map(Vec::as_slice).unwrap_or(&[]);
    let expected = a
        .len()
        .checked_mul(b.len())
        .ok_or_else(|| EngineError::Node("Cartesian result size overflowed.".into()))?;
    let configured = config
        .get("maxResults")
        .and_then(Value::as_u64)
        .unwrap_or(limits.max_cartesian_items as u64) as usize;
    let maximum = configured
        .min(limits.max_cartesian_items)
        .min(limits.max_result_items);
    if expected > maximum {
        return limit_error(
            "collection_cartesian_limit",
            format!(
                "Cartesian Merge would create {expected} items, exceeding hard limit {maximum}."
            ),
        );
    }
    let mut out = Vec::with_capacity(expected);
    for left in a {
        for right in b {
            out.push(merge_items(
                config,
                [(ordered[0].as_str(), left), (ordered[1].as_str(), right)].into_iter(),
            )?);
        }
    }
    Ok(out)
}

fn choose_branch(
    config: &Value,
    ordered: &[String],
    ports: &BTreeMap<String, Vec<WorkflowItem>>,
) -> Vec<WorkflowItem> {
    let priorities = config
        .get("priority")
        .and_then(Value::as_array)
        .map(|v| v.iter().filter_map(Value::as_str).collect::<Vec<_>>())
        .unwrap_or_else(|| ordered.iter().map(String::as_str).collect());
    if config.get("chooseStrategy").and_then(Value::as_str) == Some("first_successful") {
        let successful = config
            .get("successfulInputPorts")
            .and_then(Value::as_array)
            .map(|values| {
                values
                    .iter()
                    .filter_map(Value::as_str)
                    .collect::<HashSet<_>>()
            })
            .unwrap_or_default();
        return priorities
            .into_iter()
            .find(|port| successful.contains(port))
            .and_then(|port| ports.get(port).cloned())
            .unwrap_or_default();
    }
    priorities
        .into_iter()
        .find_map(|p| ports.get(p).filter(|v| !v.is_empty()).cloned())
        .unwrap_or_default()
}

fn wait_all_item(ordered: &[String], ports: &BTreeMap<String, Vec<WorkflowItem>>) -> WorkflowItem {
    let mut item = WorkflowItem::json(Value::Object(
        ordered
            .iter()
            .map(|port| {
                (
                    port.clone(),
                    Value::Array(
                        ports
                            .get(port)
                            .into_iter()
                            .flatten()
                            .map(|item| item.data.clone())
                            .collect(),
                    ),
                )
            })
            .collect(),
    ));
    let identity = ordered
        .iter()
        .flat_map(|port| {
            ports
                .get(port)
                .into_iter()
                .flatten()
                .map(move |source| (port, source))
        })
        .map(|(port, source)| format!("{port}:{}", source.item_id))
        .collect::<Vec<_>>()
        .join("|");
    item.item_id = format!("merge:{:x}", Sha256::digest(identity.as_bytes()));
    for port in ordered {
        for source in ports.get(port).into_iter().flatten() {
            item.correlations.insert(
                format!("input:{port}:{}", source.current_position.unwrap_or(0)),
                source.item_id.clone(),
            );
        }
    }
    item
}

fn merge_items<'a>(
    config: &Value,
    values: impl Iterator<Item = (&'a str, &'a WorkflowItem)>,
) -> Result<WorkflowItem, EngineError> {
    let strategy = config
        .get("conflictStrategy")
        .and_then(Value::as_str)
        .unwrap_or("nest");
    let collected = values.collect::<Vec<_>>();
    let data = if strategy == "nest" {
        Value::Object(
            collected
                .iter()
                .map(|(p, item)| (p.to_string(), item.data.clone()))
                .collect(),
        )
    } else {
        let mut out = Map::new();
        for (port, item) in &collected {
            let object = item.data.as_object().ok_or_else(|| {
                EngineError::Node("Flat Merge conflict strategies require object items.".into())
            })?;
            for (key, value) in object {
                let target = if strategy == "prefix" {
                    format!("{port}_{key}")
                } else {
                    key.clone()
                };
                if out.contains_key(&target) {
                    match strategy {
                        "prefer_left" => continue,
                        "prefer_right" => {}
                        "fail" => {
                            return Err(EngineError::Node(format!(
                                "Merge property conflict on '{target}'."
                            )))
                        }
                        _ => {}
                    }
                }
                out.insert(target, value.clone());
            }
        }
        Value::Object(out)
    };
    let mut merged = WorkflowItem::json(data);
    let identity = collected
        .iter()
        .map(|(port, item)| format!("{port}:{}", item.item_id))
        .collect::<Vec<_>>()
        .join("|");
    merged.item_id = format!("merge:{:x}", Sha256::digest(identity.as_bytes()));
    if let Some((_, first)) = collected.first() {
        merged.parent_item_id = Some(first.item_id.clone());
        merged.origin_item_id = first
            .origin_item_id
            .clone()
            .or_else(|| Some(first.item_id.clone()));
    }
    for (port, item) in collected {
        merged
            .correlations
            .insert(format!("input:{port}"), item.item_id.clone());
        merged.branch_history.extend(
            item.branch_history
                .iter()
                .map(|branch| format!("{port}:{branch}")),
        );
        for (name, binary) in &item.binary {
            merged
                .binary
                .insert(format!("{port}:{name}"), binary.clone());
        }
        for (name, path) in &item.trusted_paths {
            merged
                .trusted_paths
                .insert(format!("{port}:{name}"), path.clone());
        }
    }
    Ok(merged)
}

fn numeric_aggregate(operation: &str, values: &[Value]) -> Result<Value, EngineError> {
    if values.is_empty() {
        return Ok(Value::Null);
    }
    let nums = values
        .iter()
        .map(|v| {
            v.as_f64().ok_or_else(|| {
                EngineError::Node(format!(
                    "Aggregate '{operation}' requires numbers; strings are not coerced."
                ))
            })
        })
        .collect::<Result<Vec<_>, _>>()?;
    let value = match operation {
        "sum" => nums.iter().sum(),
        "minimum" => nums.iter().copied().fold(f64::INFINITY, f64::min),
        "maximum" => nums.iter().copied().fold(f64::NEG_INFINITY, f64::max),
        _ => nums.iter().sum::<f64>() / nums.len() as f64,
    };
    Number::from_f64(value)
        .map(Value::Number)
        .ok_or_else(|| EngineError::Node("Numeric aggregate produced a non-finite value.".into()))
}

fn group_by(config: &Value, inputs: &[WorkflowItem]) -> Value {
    let fields = config
        .get("groupFields")
        .and_then(Value::as_array)
        .map(|v| v.iter().filter_map(Value::as_str).collect::<Vec<_>>())
        .unwrap_or_default();
    let mut groups: BTreeMap<String, Vec<Value>> = BTreeMap::new();
    for item in inputs {
        let key = fields
            .iter()
            .map(|f| match lookup_path(&item.data, f) {
                PathValue::Present(v) => canonical(v),
                PathValue::Missing => "<missing>".into(),
            })
            .collect::<Vec<_>>()
            .join("|");
        groups.entry(key).or_default().push(item.data.clone());
    }
    Value::Array(
        groups
            .into_iter()
            .map(|(key, items)| json!({"key":key,"items":items,"count":items.len()}))
            .collect(),
    )
}

fn object_by_key(config: &Value, inputs: &[WorkflowItem]) -> Result<Value, EngineError> {
    let field = config
        .get("keyField")
        .and_then(Value::as_str)
        .unwrap_or("id");
    let duplicate = config
        .get("duplicateKeyPolicy")
        .and_then(Value::as_str)
        .unwrap_or("fail");
    let mut out = Map::new();
    for item in inputs {
        let key = match lookup_path(&item.data, field) {
            PathValue::Present(Value::String(v)) => v.clone(),
            PathValue::Present(v) => canonical(v),
            PathValue::Missing => {
                return Err(EngineError::Node(format!(
                    "Object by key is missing '{field}'."
                )))
            }
        };
        if out.contains_key(&key) {
            match duplicate {
                "keep_first" => continue,
                "keep_last" => {}
                _ => {
                    return Err(EngineError::Node(format!(
                        "Object by key found duplicate key '{key}'."
                    )))
                }
            }
        }
        out.insert(key, item.data.clone());
    }
    Ok(Value::Object(out))
}

pub fn evaluate_operator(
    operator: &str,
    left: PathValue<'_>,
    right: &Value,
) -> Result<bool, EngineError> {
    let present = match left {
        PathValue::Missing => None,
        PathValue::Present(value) => Some(value),
    };
    let result = match operator {
        "exists" => present.is_some(),
        "not_exists" => present.is_none(),
        "is_null" => matches!(present, Some(Value::Null)),
        "is_not_null" => present.is_some_and(|v| !v.is_null()),
        "is_empty" => present.is_some_and(is_empty),
        "is_not_empty" => present.is_some_and(|v| !is_empty(v)),
        "equals" => present.is_some_and(|v| strict_equal(v, right)),
        "not_equals" => present.is_some_and(|v| !strict_equal(v, right)),
        "contains" => present.is_some_and(|v| contains(v, right)),
        "not_contains" => present.is_some_and(|v| !contains(v, right)),
        "array_contains" => present
            .and_then(Value::as_array)
            .is_some_and(|a| a.iter().any(|v| strict_equal(v, right))),
        "starts_with" => strings(present, right).is_some_and(|(a, b)| a.starts_with(b)),
        "ends_with" => strings(present, right).is_some_and(|(a, b)| a.ends_with(b)),
        "greater_than" => numbers(present, right).is_some_and(|(a, b)| a > b),
        "greater_than_or_equal" => numbers(present, right).is_some_and(|(a, b)| a >= b),
        "less_than" => numbers(present, right).is_some_and(|(a, b)| a < b),
        "less_than_or_equal" => numbers(present, right).is_some_and(|(a, b)| a <= b),
        "matches_regex" => {
            let pattern = right.as_str().ok_or_else(|| {
                EngineError::Node("Regular expression pattern must be a string.".into())
            })?;
            if pattern.len() > 1024 {
                return Err(EngineError::Node(
                    "Regular expression exceeds the 1,024 character safety limit.".into(),
                ));
            }
            let regex = Regex::new(pattern)
                .map_err(|e| EngineError::Node(format!("Invalid regular expression: {e}")))?;
            present
                .and_then(Value::as_str)
                .is_some_and(|text| regex.is_match(text))
        }
        "is_one_of" | "is_not_one_of" => {
            let found = right
                .as_array()
                .is_some_and(|a| present.is_some_and(|v| a.iter().any(|x| strict_equal(v, x))));
            if operator == "is_one_of" {
                found
            } else {
                !found
            }
        }
        "date_before" | "date_after" => {
            let b = parse_date(Some(right))?;
            match parse_optional_date(present)? {
                Some(a) => {
                    if operator == "date_before" {
                        a < b
                    } else {
                        a > b
                    }
                }
                None => false,
            }
        }
        "date_between" => {
            let bounds = right.as_array().filter(|v| v.len() == 2).ok_or_else(|| {
                EngineError::Node("Date between requires a two-value RFC 3339 array.".into())
            })?;
            let start = parse_date(Some(&bounds[0]))?;
            let end = parse_date(Some(&bounds[1]))?;
            match parse_optional_date(present)? {
                Some(a) => a >= start && a <= end,
                None => false,
            }
        }
        other => {
            return Err(EngineError::Node(format!(
                "Rule operator '{other}' is not supported."
            )))
        }
    };
    Ok(result)
}

fn evaluate_rule_group(config: &Value, item: &Value) -> Result<bool, EngineError> {
    let combinator = config
        .get("combinator")
        .or_else(|| config.get("match"))
        .and_then(Value::as_str)
        .unwrap_or("all");
    let rules = config.get("rules").and_then(Value::as_array);
    if let Some(rules) = rules {
        if rules.is_empty() {
            return Ok(true);
        }
        let mut values = Vec::new();
        for rule in rules {
            if rule.get("rules").is_some() {
                values.push(evaluate_rule_group(rule, item)?);
            } else {
                let path = rule
                    .get("field")
                    .or_else(|| rule.get("fieldPath"))
                    .and_then(Value::as_str)
                    .unwrap_or("");
                let operator = rule
                    .get("operator")
                    .and_then(Value::as_str)
                    .unwrap_or("equals");
                let right = rule
                    .get("value")
                    .or_else(|| rule.get("right"))
                    .unwrap_or(&Value::Null);
                values.push(evaluate_operator(operator, lookup_path(item, path), right)?);
            }
        }
        return Ok(if combinator == "any" {
            values.into_iter().any(|v| v)
        } else {
            values.into_iter().all(|v| v)
        });
    }
    let path = config
        .get("field")
        .or_else(|| config.get("fieldPath"))
        .and_then(Value::as_str)
        .unwrap_or("");
    let operator = config
        .get("operator")
        .and_then(Value::as_str)
        .unwrap_or("equals");
    let right = config
        .get("value")
        .or_else(|| config.get("right"))
        .unwrap_or(&Value::Null);
    evaluate_operator(operator, lookup_path(item, path), right)
}

#[derive(Clone, Copy)]
pub enum PathValue<'a> {
    Missing,
    Present(&'a Value),
}
impl<'a> PathValue<'a> {
    fn is_present_and(self, f: impl FnOnce(&Value) -> bool) -> bool {
        matches!(self,Self::Present(v) if f(v))
    }
    fn type_name(self) -> &'static str {
        match self {
            Self::Missing => "missing",
            Self::Present(Value::Null) => "null",
            Self::Present(Value::Bool(_)) => "boolean",
            Self::Present(Value::Number(_)) => "number",
            Self::Present(Value::String(_)) => "string",
            Self::Present(Value::Array(_)) => "array",
            Self::Present(Value::Object(_)) => "object",
        }
    }
}

fn attach_rule_evidence(config: &Value, item: &mut WorkflowItem) -> Result<(), EngineError> {
    if let Some(rules) = config.get("rules").and_then(Value::as_array) {
        for (index, rule) in rules.iter().enumerate() {
            if rule.get("rules").is_some() {
                continue;
            }
            let path = rule
                .get("field")
                .or_else(|| rule.get("fieldPath"))
                .and_then(Value::as_str)
                .unwrap_or("");
            let operator = rule
                .get("operator")
                .and_then(Value::as_str)
                .unwrap_or("equals");
            let right = rule
                .get("value")
                .or_else(|| rule.get("right"))
                .unwrap_or(&Value::Null);
            let left = lookup_path(&item.data, path);
            let id = rule
                .get("id")
                .and_then(Value::as_str)
                .map(str::to_string)
                .unwrap_or_else(|| format!("rule_{index}"));
            item.correlations.insert(
                format!("rule:{id}"),
                format!(
                    "matched={}; left={}; right={}",
                    evaluate_operator(operator, left, right)?,
                    left.type_name(),
                    value_type(right)
                ),
            );
        }
    }
    Ok(())
}
fn value_type(value: &Value) -> &'static str {
    match value {
        Value::Null => "null",
        Value::Bool(_) => "boolean",
        Value::Number(_) => "number",
        Value::String(_) => "string",
        Value::Array(_) => "array",
        Value::Object(_) => "object",
    }
}

pub fn lookup_path<'a>(value: &'a Value, path: &str) -> PathValue<'a> {
    if path.is_empty() || path == "$" {
        return PathValue::Present(value);
    }
    let mut current = value;
    for segment in path
        .trim_start_matches("$.")
        .trim_start_matches('/')
        .split(['.', '/'])
        .filter(|s| !s.is_empty())
    {
        current = match current {
            Value::Object(o) => match o.get(segment) {
                Some(v) => v,
                None => return PathValue::Missing,
            },
            Value::Array(a) => match segment.parse::<usize>().ok().and_then(|i| a.get(i)) {
                Some(v) => v,
                None => return PathValue::Missing,
            },
            _ => return PathValue::Missing,
        };
    }
    PathValue::Present(current)
}

fn remove_path(value: &mut Value, path: &str) {
    let parts = path.trim_start_matches("$.").split('.').collect::<Vec<_>>();
    if let Some((last, parents)) = parts.split_last() {
        let mut current = value;
        for part in parents {
            let Some(next) = current.get_mut(*part) else {
                return;
            };
            current = next;
        }
        if let Value::Object(object) = current {
            object.remove(*last);
        }
    }
}
fn insert_path(value: &mut Value, path: &str, new_value: Value) -> Result<(), EngineError> {
    if path.is_empty() {
        *value = new_value;
        return Ok(());
    }
    if !value.is_object() {
        *value = json!({});
    }
    let parts = path
        .split('.')
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>();
    let mut current = value.as_object_mut().unwrap();
    for part in &parts[..parts.len().saturating_sub(1)] {
        current = current
            .entry((*part).to_string())
            .or_insert_with(|| json!({}))
            .as_object_mut()
            .ok_or_else(|| {
                EngineError::Node(format!(
                    "Cannot place split value beneath non-object field '{part}'."
                ))
            })?;
    }
    current.insert(parts.last().unwrap().to_string(), new_value);
    Ok(())
}
fn strict_equal(a: &Value, b: &Value) -> bool {
    std::mem::discriminant(a) == std::mem::discriminant(b) && a == b
}
fn contains(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::String(a), Value::String(b)) => a.contains(b),
        (Value::Array(a), b) => a.iter().any(|v| strict_equal(v, b)),
        _ => false,
    }
}
fn strings<'a>(left: Option<&'a Value>, right: &'a Value) -> Option<(&'a str, &'a str)> {
    Some((left?.as_str()?, right.as_str()?))
}
fn numbers(left: Option<&Value>, right: &Value) -> Option<(f64, f64)> {
    Some((left?.as_f64()?, right.as_f64()?))
}
fn is_empty(value: &Value) -> bool {
    match value {
        Value::String(v) => v.is_empty(),
        Value::Array(v) => v.is_empty(),
        Value::Object(v) => v.is_empty(),
        _ => false,
    }
}
fn parse_date(value: Option<&Value>) -> Result<DateTime<Utc>, EngineError> {
    let text = value.and_then(Value::as_str).ok_or_else(|| {
        EngineError::Node("Date rules require RFC 3339 strings; values are not coerced.".into())
    })?;
    DateTime::parse_from_rfc3339(text)
        .map(|v| v.with_timezone(&Utc))
        .map_err(|_| EngineError::Node(format!("'{text}' is not a valid RFC 3339 date.")))
}
fn parse_optional_date(value: Option<&Value>) -> Result<Option<DateTime<Utc>>, EngineError> {
    match value {
        Some(Value::String(text)) => DateTime::parse_from_rfc3339(text)
            .map(|value| Some(value.with_timezone(&Utc)))
            .map_err(|_| EngineError::Node(format!("'{text}' is not a valid RFC 3339 date."))),
        _ => Ok(None),
    }
}

fn dedupe_key(config: &Value, item: &WorkflowItem) -> Result<String, EngineError> {
    let fields = config
        .get("fields")
        .and_then(Value::as_array)
        .map(|v| v.iter().filter_map(Value::as_str).collect::<Vec<_>>())
        .unwrap_or_default();
    let mut selected = if fields.is_empty() {
        json!({"data":&item.data,"binary":&item.binary,"trustedPaths":&item.trusted_paths})
    } else {
        Value::Array(
            fields
                .iter()
                .map(|f| match lookup_path(&item.data, f) {
                    PathValue::Present(v) => json!({"present":v}),
                    PathValue::Missing => json!({"missing":true}),
                })
                .collect(),
        )
    };
    normalize_strings(
        &mut selected,
        config
            .get("caseSensitive")
            .and_then(Value::as_bool)
            .unwrap_or(true),
        config
            .get("normalizeWhitespace")
            .and_then(Value::as_bool)
            .unwrap_or(false),
    );
    Ok(canonical(&selected))
}
fn normalize_strings(value: &mut Value, case_sensitive: bool, whitespace: bool) {
    match value {
        Value::String(v) => {
            if whitespace {
                *v = v.split_whitespace().collect::<Vec<_>>().join(" ");
            }
            if !case_sensitive {
                *v = v.to_lowercase();
            }
        }
        Value::Array(v) => {
            for x in v {
                normalize_strings(x, case_sensitive, whitespace)
            }
        }
        Value::Object(v) => {
            for x in v.values_mut() {
                normalize_strings(x, case_sensitive, whitespace)
            }
        }
        _ => {}
    }
}
fn canonical(value: &Value) -> String {
    match value {
        Value::Null => "null".into(),
        Value::Bool(v) => format!("b:{v}"),
        Value::Number(v) => format!("n:{v}"),
        Value::String(v) => format!("s:{}:{v}", v.len()),
        Value::Array(v) => format!(
            "a:[{}]",
            v.iter().map(canonical).collect::<Vec<_>>().join(",")
        ),
        Value::Object(v) => {
            let mut keys = v.keys().collect::<Vec<_>>();
            keys.sort();
            format!(
                "o:{{{}}}",
                keys.into_iter()
                    .map(|k| format!(
                        "{}:{}",
                        canonical(&Value::String(k.clone())),
                        canonical(&v[k])
                    ))
                    .collect::<Vec<_>>()
                    .join(",")
            )
        }
    }
}

fn normalize_input_identities(source: &str, items: &mut [WorkflowItem]) {
    for (index, item) in items.iter_mut().enumerate() {
        if item.item_id.is_empty() {
            item.item_id = format!("{source}:{index}");
        }
        if item.origin_item_id.is_none() {
            item.origin_item_id = Some(item.item_id.clone());
        }
        item.original_position.get_or_insert(index);
        item.current_position = Some(index);
        item.execution_attempt = item.execution_attempt.max(1);
    }
}
fn set_positions(items: &mut [WorkflowItem]) {
    for (index, item) in items.iter_mut().enumerate() {
        item.current_position = Some(index);
    }
}
fn items_output(items: &[WorkflowItem]) -> Value {
    json!({"items":items})
}
fn output_with_branches(
    items: &[WorkflowItem],
    branches: &BTreeMap<String, Vec<WorkflowItem>>,
) -> Value {
    json!({"items":items,"branches":branches.iter().map(|(k,v)|(k.clone(),items_output(v))).collect::<BTreeMap<_,_>>()})
}
fn evidence(
    items: &[WorkflowItem],
    input_count: usize,
    rejected: usize,
    ordering: &str,
    limits: &CollectionLimits,
) -> CollectionEvidence {
    let preview_count = items.len().min(limits.max_history_item_previews);
    CollectionEvidence {
        input_item_count: input_count,
        output_item_count: items.len(),
        rejected_item_count: rejected,
        branch_counts: Default::default(),
        iteration_count: 0,
        batch_count: 0,
        sample_items: items[..preview_count].to_vec(),
        preview_truncated: items.len() > preview_count,
        runtime_data_truncated: false,
        ordering_policy: ordering.into(),
        stop_reason: None,
        waiting_for_inputs: vec![],
    }
}
fn set_evidence_samples(
    evidence: &mut CollectionEvidence,
    items: &[WorkflowItem],
    limits: &CollectionLimits,
) {
    let count = items.len().min(limits.max_history_item_previews);
    evidence.sample_items = items[..count].to_vec();
    evidence.preview_truncated = items.len() > count;
}
fn enforce_input_limits(
    items: &[WorkflowItem],
    limits: &CollectionLimits,
) -> Result<(), EngineError> {
    if items.len() > limits.max_input_items {
        return limit_error(
            "collection_input_item_limit",
            format!(
                "Collection contains {} items, exceeding runner input limit {}.",
                items.len(),
                limits.max_input_items
            ),
        );
    }
    for item in items {
        let size = serde_json::to_vec(&item.data)
            .map_err(|e| EngineError::Node(e.to_string()))?
            .len();
        if size > limits.max_item_bytes {
            return limit_error(
                "collection_item_size_limit",
                format!(
                    "Item '{}' is {size} bytes, exceeding runner item limit {} bytes.",
                    item.item_id, limits.max_item_bytes
                ),
            );
        }
    }
    Ok(())
}
fn enforce_result_limits(
    items: &[WorkflowItem],
    limits: &CollectionLimits,
) -> Result<(), EngineError> {
    if items.len() > limits.max_result_items {
        return limit_error(
            "collection_result_item_limit",
            format!(
                "Collection result contains {} items, exceeding runner result limit {}.",
                items.len(),
                limits.max_result_items
            ),
        );
    }
    enforce_input_limits(
        items,
        &CollectionLimits {
            max_input_items: limits.max_result_items,
            ..limits.clone()
        },
    )
}
fn limit_error<T>(code: &str, message: String) -> Result<T, EngineError> {
    Err(EngineError::NodeCode {
        code: code.into(),
        message,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn items(values: Value) -> Vec<WorkflowItem> {
        values
            .as_array()
            .unwrap()
            .iter()
            .cloned()
            .map(WorkflowItem::json)
            .collect()
    }
    #[test]
    fn filter_preserves_missing_null_and_types() {
        let result = execute_filter(
            &json!({"rules":[{"field":"value","operator":"is_null"}]}),
            items(json!([{"value":null},{},{"value":""}])),
            &CollectionLimits::default(),
        )
        .unwrap();
        assert_eq!(result.output_items.len(), 1);
        assert_eq!(result.evidence.rejected_item_count, 2);
        assert!(
            !evaluate_operator("equals", PathValue::Present(&json!(200)), &json!("200")).unwrap()
        );
    }
    #[test]
    fn filter_supports_all_any_dates_regex_and_hidden_rejected() {
        let result=execute_filter(&json!({"combinator":"any","exposeRejected":false,"rules":[{"field":"name","operator":"matches_regex","value":"^A.+"},{"field":"at","operator":"date_between","value":["2026-01-01T00:00:00Z","2026-12-31T23:59:59Z"]}]}),items(json!([{"name":"Ada","at":null},{"name":"Bob","at":"2026-06-01T00:00:00Z"},{"name":"Cal","at":"2025-01-01T00:00:00Z"}])),&CollectionLimits::default()).unwrap();
        assert_eq!(result.output_items.len(), 2);
        assert!(!result.branch_outputs.contains_key("rejected"));
    }
    #[test]
    fn every_scalar_rule_operator_has_strict_semantics() {
        let array = json!(["x", 2]);
        let date = json!("2026-06-01T00:00:00Z");
        for (operator, left, right, expected) in [
            ("exists", PathValue::Present(&json!(1)), json!(null), true),
            ("not_exists", PathValue::Missing, json!(null), true),
            (
                "is_empty",
                PathValue::Present(&json!([])),
                json!(null),
                true,
            ),
            (
                "is_not_empty",
                PathValue::Present(&json!({"a":1})),
                json!(null),
                true,
            ),
            ("not_equals", PathValue::Present(&json!(1)), json!(2), true),
            (
                "contains",
                PathValue::Present(&json!("alphabet")),
                json!("pha"),
                true,
            ),
            (
                "not_contains",
                PathValue::Present(&json!("alphabet")),
                json!("zzz"),
                true,
            ),
            (
                "starts_with",
                PathValue::Present(&json!("alpha")),
                json!("al"),
                true,
            ),
            (
                "ends_with",
                PathValue::Present(&json!("alpha")),
                json!("ha"),
                true,
            ),
            (
                "greater_than_or_equal",
                PathValue::Present(&json!(2)),
                json!(2),
                true,
            ),
            (
                "less_than_or_equal",
                PathValue::Present(&json!(2)),
                json!(2),
                true,
            ),
            (
                "is_one_of",
                PathValue::Present(&json!(2)),
                json!([1, 2]),
                true,
            ),
            (
                "is_not_one_of",
                PathValue::Present(&json!(3)),
                json!([1, 2]),
                true,
            ),
            ("array_contains", PathValue::Present(&array), json!(2), true),
            (
                "date_after",
                PathValue::Present(&date),
                json!("2026-01-01T00:00:00Z"),
                true,
            ),
        ] {
            assert_eq!(
                evaluate_operator(operator, left, &right).unwrap(),
                expected,
                "{operator}"
            );
        }
    }
    #[test]
    fn switch_all_match_keeps_shared_origin() {
        let result=execute_switch(&json!({"mode":"all_matches","cases":[{"id":"a","rules":[{"field":"n","operator":"greater_than","value":0}]},{"id":"b","rules":[{"field":"n","operator":"less_than","value":10}]}]}),items(json!([{"n":5}])),&CollectionLimits::default()).unwrap();
        assert_eq!(result.output_items.len(), 2);
        assert_eq!(
            result.output_items[0].origin_item_id,
            result.output_items[1].origin_item_id
        );
    }
    #[test]
    fn switch_first_match_and_fallback_are_evidenced() {
        let result=execute_switch(&json!({"mode":"first_match","routingMode":"value","valuePath":"status","fallbackBranchId":"other","cases":[{"id":"active","value":"active"},{"id":"also","value":"active"}]}),items(json!([{"status":"active"},{"status":"unknown"}])),&CollectionLimits::default()).unwrap();
        assert_eq!(result.branch_outputs["active"].len(), 1);
        assert!(result.branch_outputs["also"].is_empty());
        assert_eq!(result.branch_outputs["other"][0].status, "unmatched");
    }
    #[test]
    fn split_nested_array_retains_lineage() {
        let result=execute_split_out(&json!({"fieldPath":"body.rows","destinationField":"row","keepParentFields":true,"keepOriginalArray":false,"includeIndex":true}),items(json!([{"body":{"rows":[{"id":1},{"id":2}]},"request":"r"}])),&CollectionLimits::default()).unwrap();
        assert_eq!(result.output_items.len(), 2);
        assert!(result.output_items[0].parent_item_id.is_some());
        assert_eq!(
            lookup_path(&result.output_items[1].data, "row.id").is_present_and(|v| v == &json!(2)),
            true
        );
    }
    #[test]
    fn split_distinguishes_empty_missing_and_non_array() {
        let empty = execute_split_out(
            &json!({"fieldPath":"rows","emptyArrayPolicy":"keep_parent"}),
            items(json!([{"rows":[]}])),
            &CollectionLimits::default(),
        )
        .unwrap();
        assert_eq!(empty.output_items.len(), 1);
        let rejected = execute_split_out(
            &json!({"fieldPath":"rows","invalidInputPolicy":"rejected"}),
            items(json!([{}, {"rows":"no"}])),
            &CollectionLimits::default(),
        )
        .unwrap();
        assert_eq!(rejected.branch_outputs["rejected"].len(), 2);
    }
    #[test]
    fn dedupe_uses_stable_object_order() {
        let result = execute_dedupe(
            "d",
            &json!({}),
            items(json!([{"a":1,"b":2},{"b":2,"a":1}])),
            &CollectionLimits::default(),
            None,
        )
        .unwrap();
        assert_eq!(result.output_items.len(), 1);
    }
    #[test]
    fn item_binary_and_trusted_paths_round_trip_and_affect_whole_item_equality() {
        let mut first = WorkflowItem::json(json!({"id":1}));
        first.item_id = "item-1".into();
        first
            .trusted_paths
            .insert("file".into(), "trusted://one".into());
        first.binary.insert(
            "attachment".into(),
            crate::BinaryReference {
                reference: "artifact://one".into(),
                file_name: Some("one.txt".into()),
                ..Default::default()
            },
        );
        let restored: WorkflowItem =
            serde_json::from_value(serde_json::to_value(&first).unwrap()).unwrap();
        assert_eq!(restored, first);
        let mut second = first.clone();
        second.item_id = "item-2".into();
        second
            .trusted_paths
            .insert("file".into(), "trusted://two".into());
        let result = execute_dedupe(
            "d",
            &json!({}),
            vec![first, second],
            &CollectionLimits::default(),
            None,
        )
        .unwrap();
        assert_eq!(result.output_items.len(), 2);
    }
    #[test]
    fn dedupe_keys_normalize_and_cross_run_updates_are_staged() {
        let result=execute_dedupe("d",&json!({"fields":["email","tenant"],"caseSensitive":false,"normalizeWhitespace":true,"keep":"last","scope":"workflow_state"}),items(json!([{"email":" ADA@EXAMPLE.COM ","tenant":1},{"email":"ada@example.com","tenant":1}])),&CollectionLimits::default(),None).unwrap();
        assert_eq!(result.output_items.len(), 1);
        assert_eq!(
            result.output_items[0].data["email"],
            json!("ada@example.com")
        );
        assert!(result.state_update.is_some());
        assert_eq!(result.branch_outputs["duplicates"].len(), 1);
    }
    #[test]
    fn aggregate_rejects_numeric_strings() {
        assert!(execute_aggregate(
            &json!({"operation":"sum","fieldPath":"value"}),
            items(json!([{"value":1},{"value":"2"}])),
            &CollectionLimits::default()
        )
        .is_err());
    }
    #[test]
    fn aggregate_operations_are_deterministic() {
        let input = items(
            json!([{"team":"b","n":2,"s":"x"},{"team":"a","n":4,"s":"y"},{"team":"b","n":6,"s":"z"}]),
        );
        for (operation, expected) in [
            ("count", json!(3)),
            ("sum", json!(12.0)),
            ("minimum", json!(2.0)),
            ("maximum", json!(6.0)),
            ("average", json!(4.0)),
            ("first", json!(2)),
            ("last", json!(6)),
        ] {
            let result = execute_aggregate(
                &json!({"operation":operation,"fieldPath":"n"}),
                input.clone(),
                &CollectionLimits::default(),
            )
            .unwrap();
            assert_eq!(result.output["value"], expected, "{operation}");
        }
        let concat = execute_aggregate(
            &json!({"operation":"concatenate","fieldPath":"s","separator":"|"}),
            input.clone(),
            &CollectionLimits::default(),
        )
        .unwrap();
        assert_eq!(concat.output["value"], json!("x|y|z"));
        let grouped = execute_aggregate(
            &json!({"operation":"group_by","groupFields":["team"]}),
            input,
            &CollectionLimits::default(),
        )
        .unwrap();
        assert_eq!(grouped.output["value"][0]["count"], json!(1));
    }
    #[test]
    fn merge_modes_use_port_order_and_preserve_correlations() {
        let ports = BTreeMap::from([
            (
                "a".into(),
                items(json!([{"id":1,"left":"a"},{"id":2,"left":"b"}])),
            ),
            (
                "b".into(),
                items(json!([{"id":2,"right":"x"},{"id":2,"right":"y"}])),
            ),
        ]);
        let config = json!({"mode":"combine_fields","inputPorts":[{"id":"a"},{"id":"b"}],"leftKey":"id","rightKey":"id","join":"full","conflictStrategy":"nest"});
        let result = execute_merge(&config, ports, &CollectionLimits::default()).unwrap();
        assert_eq!(result.output_items.len(), 3);
        assert!(result
            .output_items
            .iter()
            .all(|item| !item.correlations.is_empty()));
    }
    #[test]
    fn merge_position_policies_and_conflicts_are_explicit() {
        let ports = BTreeMap::from([
            ("a".into(), items(json!([{"v":1},{"v":2}]))),
            ("b".into(), items(json!([{"v":3}]))),
        ]);
        let fail = execute_merge(
            &json!({"mode":"combine_position","inputPorts":[{"id":"a"},{"id":"b"}],"unmatchedPolicy":"fail"}),
            ports.clone(),
            &CollectionLimits::default(),
        );
        assert!(fail.is_err());
        let dropped=execute_merge(&json!({"mode":"combine_position","inputPorts":[{"id":"a"},{"id":"b"}],"unmatchedPolicy":"drop","conflictStrategy":"prefer_right"}),ports,&CollectionLimits::default()).unwrap();
        assert_eq!(dropped.output_items.len(), 1);
        assert_eq!(dropped.output_items[0].data["v"], json!(3));
    }
    #[test]
    fn cartesian_enforces_limit() {
        let limits = CollectionLimits {
            max_cartesian_items: 3,
            ..Default::default()
        };
        let ports = BTreeMap::from([
            ("a".into(), items(json!([1, 2]))),
            ("b".into(), items(json!([3, 4]))),
        ]);
        let err = execute_merge(
            &json!({"mode":"cartesian","inputPorts":[{"id":"a"},{"id":"b"}]}),
            ports,
            &limits,
        )
        .unwrap_err();
        assert_eq!(err.execution_error().code, "collection_cartesian_limit");
    }
    #[test]
    fn aggregate_size_and_loop_limits_use_stable_codes() {
        let limits = CollectionLimits {
            max_aggregate_bytes: 2,
            max_loop_iterations: 1,
            ..Default::default()
        };
        let aggregate = execute_aggregate(
            &json!({"operation":"collect_items"}),
            items(json!([{"long":"value"}])),
            &limits,
        )
        .unwrap_err();
        assert_eq!(
            aggregate.execution_error().code,
            "collection_aggregate_size_limit"
        );
        let looped = execute_loop(
            &json!({"batchSize":1,"maxIterations":1}),
            items(json!([1, 2])),
            &limits,
        )
        .unwrap_err();
        assert_eq!(
            looped.execution_error().code,
            "collection_loop_iteration_limit"
        );
    }
    #[test]
    fn boundary_sized_filter_keeps_authoritative_counts_and_bounded_preview() {
        let limits = CollectionLimits {
            max_history_item_previews: 25,
            ..Default::default()
        };
        let input = (0..limits.max_input_items)
            .map(|index| WorkflowItem::json(json!({"index":index,"active":index%2==0})))
            .collect();
        let result = execute_filter(
            &json!({"rules":[{"field":"active","operator":"equals","value":true}]}),
            input,
            &limits,
        )
        .unwrap();
        assert_eq!(result.evidence.input_item_count, 10_000);
        assert_eq!(result.evidence.output_item_count, 5_000);
        assert_eq!(result.evidence.sample_items.len(), 25);
        assert!(result.evidence.preview_truncated);
    }
}
