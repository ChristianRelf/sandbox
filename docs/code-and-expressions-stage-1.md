# Code nodes and expressions (Stage 1)

Stage 1 introduces one versioned data contract for ordinary nodes, expressions,
JavaScript Code, Python Code, node tests and execution inspection. Workflow
schema 5 and expression language 1 are the compatibility boundary.

## Runtime data

Every node still exposes its backwards-compatible JSON `output`. Execution
records additionally normalise values into `inputItems` and `outputItems`:

```json
{
  "data": { "customerId": "cus_123" },
  "binary": {
    "invoice": {
      "reference": "artifact-grant-id",
      "fileName": "invoice.pdf",
      "contentType": "application/pdf",
      "sizeBytes": 48211,
      "sha256": "..."
    }
  },
  "sourceNodeId": "download",
  "sourceItemIndex": 0,
  "branch": "output"
}
```

Binary bytes are not embedded. The reference is subject to the existing
artifact grant, retention and permission checks. Credentials are never part of
this object. Node errors, retry state, branch choice, runtime metadata, lineage,
capability use and test-data provenance remain separate execution fields.

## Fixed values and expressions

A fixed value is stored and used as entered. Expression mode evaluates the
field against the node's reachable runtime context. A full-field expression
preserves its JSON type; interpolation always produces a string.

```text
{{ nodes.extract.output.data.heading }}
The page title is {{ nodes.extract.output.data.heading }}
{{ trigger.body.customer.email }}
{{ workflow.name }}
{{ execution.id }}
{{ input.data.total }}
{{ env.ALLOWED_VALUE }}
```

Environment expressions are limited to explicitly allowlisted names and are
resolved only on the runner. The allowlist is for non-secret configuration;
secrets must use credential bindings and are never expression values.

Available roots are `input`, `items`, `nodes`, `trigger`, `workflow`,
`execution`, and the explicitly approved names under `env`. Dotted and numeric
array access are supported. Use safe access (`input.customer?.email`) when a
property may be absent, or null coalescing (`input.total ?? 0`) for a fallback.
Missing, null, false, zero and the empty string are distinct.

Expression language 1 helpers are:

- `string`, `string.toString`, `string.trim`, `string.lower`, `string.upper`
- `number`, `boolean`
- `json.parse`, `json.stringify`
- `array.first`, `array.last`, `array.length`
- `object.keys`, `object.values`
- `date.iso` (RFC 3339 normalisation)

The language is parsed by an allowlisted evaluator. It does not use host
JavaScript evaluation and has no filesystem, process, network, module,
credential, random or current-time primitive. Expressions are limited to 16
KiB and 256 path segments. Prototype/constructor traversal is rejected.
Validation rejects missing, downstream and otherwise unreachable node sources.

The mapping panel lists reachable declared ports and, when present, real
properties inferred from the selected execution. Inferred fields are samples,
not fabricated schemas. Previews display the resulting type and fallback use.
Binary values appear as metadata/reference objects, and execution values have
already passed recursive secret redaction.

## JavaScript Code

Use **JavaScript Code** for execution. The legacy **Code / Source** node remains
readable so HTML, CSS and JavaScript source-block workflows continue to work.

The JavaScript runtime receives `input`, `items`, `nodes`, `trigger`,
`workflow`, `execution`, `helpers`, and `ctx`. Return JSON data, an array, or
canonical `{data, binary}` items. `console.log/warn/error` and `ctx.log` are
captured into bounded execution logs.

```js
console.log("items", items.length);
return items.map(item => ({ ...item.data, total: helpers.number(item.data.total) }));
```

Use `helpers` for the documented transformations (for example,
`helpers.string.trim(value)`). Code can run once for all items or once per item.

## Python Code

Python uses exactly the same input/output item contract. Set `result`, or define
`main(ctx)`:

```python
print("items", len(items))
result = [{**(item.get("data") or {}), "processed": True} for item in items]
```

The initial built-in Python module allowlist is `json`, `math`, `re`,
`statistics`, `collections`, `itertools`, `functools`, and `decimal`. Time and
random modules are intentionally absent; use execution metadata as the run's
time source.
Third-party Python packages are not installed.

## Limits and security boundary

- Code requires the existing revision-bound command-execution approval.
- Source is limited to 2 MiB; runtime output to 1 MiB; stdout/stderr to 64 KiB;
  execution logs to 100 bounded lines; configured timeouts to 120 seconds.
- Child environments are cleared. Windows receives only loader bootstrap paths,
  which the JavaScript wrapper does not expose to user source.
- JavaScript runs with Node's permission system, 128 MiB heap ceiling and no
  granted network, write, child-process, worker or native-addon permission.
- Python runs isolated (`-I -B`), replaces dangerous builtins/imports and uses
  an audit hook to deny file, socket, process and native-library operations.
- Cancellation kills the child process and removes the temporary wrapper.
- Time and randomness in JavaScript are fixed/seeded for a run. Expressions
  have no nondeterministic API.
- Credential values are not injected. Future credential APIs must broker an
  operation-specific binding; they must not return raw credentials.

This is a defence-in-depth local process boundary, not a container security
claim. Managed execution remains disabled until its workload images and policy
declare and enforce the matching runtime.

## Packages and target compatibility

Runtime, helper-language version, item mode and the empty dependency manifest
are stored in each Code node and therefore in immutable workflow revisions and
exports. A non-empty dependency manifest is rejected: no package name is ever
passed to a shell and no installation occurs during execution.

| Target | Expressions v1 | JavaScript Code | Python Code |
| --- | --- | --- | --- |
| Windows desktop / local runner | Yes | Yes, when compatible Node is installed | Yes, when compatible Python is installed |
| Managed hosted runner | Yes | No; image declares no Node runtime | No; image declares no Python runtime |
| Packaged Linux self-hosted runner | Yes | No; image declares no Node runtime | No; image declares no Python runtime |
| Managed browser worker | Mapping only | No | No |

The editor marks both dedicated Code nodes local-only. Hosted validation returns
language-specific incompatibility messages, and self-hosted revision activation
rejects executable Code before deployment. The runner heartbeat declares
`codeRuntimes: []` and `expressionLanguageVersions: [1]`.

## Testing and troubleshooting

Test a node from the editor with the latest execution selected, or enter
**Pinned test input** on a Code node. Pinned data is labelled in history and is
used only for manual node tests. It is ignored by full, scheduled and deployed
runs and omitted from normal exports. Clear it by saving an empty array.

Execution history has Input, Output, Items, Logs, Runtime and Lineage tabs when
the corresponding evidence exists. It includes runtime/dependency identity,
duration, attempt/retry count, bounded logs, errors, line/column when recoverable,
test-data source and redacted capability use.

Common failures:

- **Permission required:** review and approve command execution for the current
  revision; editing code revokes the previous approval.
- **Runtime could not start:** install the compatible interpreter locally or
  use a non-Code node. Do not deploy to a target marked incompatible.
- **Invalid output contract / output limit:** return JSON-serialisable values
  and keep output below 1 MiB; use binary references for files.
- **Expression value is missing:** use the picker to select a reachable source,
  safe access, or an explicit `??` fallback.
- **Package rejected:** Stage 1 supports built-ins only. Package environments
  require a future immutable build/cache/policy implementation.

## Migration and extension points

Workflow schemas 1–4 are deterministically normalised to schema 5. Existing
templates and `{{nodes.id.output.path}}` references retain their meaning.
Historical execution JSON deserialises with empty defaults for the new fields.
The item, binary, source-item and branch fields are intentionally ready for
Split, Loop, Aggregate, Merge, AI document and sub-workflow nodes without
changing Code contracts.
