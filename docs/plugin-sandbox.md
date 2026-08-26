# Plugin sandbox and capability model

## Guest ABI

Stage three uses a small WebAssembly core ABI so guests can be authored in any language that targets `wasm32-unknown-unknown`. General WASI is intentionally absent.

Required exports:

```text
memory: linear memory
alloc(length: i32) -> pointer: i32
execute(inputPointer: i32, inputLength: i32) -> packedPointerLength: i64
```

The returned `i64` stores the output pointer in the high 32 bits and UTF-8 JSON byte length in the low 32 bits. Inputs and outputs are limited to 1 MB.

The sole permitted import is:

```text
sandbox_v1::host_call(requestPointer, requestLength, outputPointer, outputCapacity) -> length
```

Requests and responses are typed JSON. A negative result indicates the required response capacity or a terminal buffer error. SDK bindings hide this ABI from plugin authors.

## Capabilities

Capabilities are declared in the signed manifest, referenced by each node, approved for a personal/workspace installation, and copied into an immutable execution context. A host call must pass all four layers.

Supported stage-three capabilities are workflow input, structured logging, time, random identifiers, limited cryptography, host-mediated network, credential operations, temporary storage, persistent storage, external communication, and file-picker reads.

There is no capability for arbitrary filesystem access, process creation, shell execution, raw sockets, environment variables, database access, raw credentials, browser profile directories, other plugin storage, or desktop IPC.

## Network policy

- HTTPS only with normal platform TLS validation
- explicit domains and methods
- optional explicit subdomains and redirects
- each redirect target re-authorized
- 30-second maximum timeout
- 1-MB request and 2-MB response limits
- 120 requests/plugin/minute default
- `Authorization`, cookies, proxy authorization, host, content length, and API-key headers rejected from guests
- provider credentials injected only inside a named host operation
- sensitive response headers redacted from diagnostics

## Storage identity

Persistent storage is keyed by publisher, plugin, owner/workspace, and normally plugin major version. Temporary storage additionally includes execution ID. Keys cannot contain paths/traversal. Quotas are declared and approved, with a 100-MB maximum per storage class in stage three.

Uninstall offers retain temporarily, export, or delete. None is implied by package removal.

## Resource controls

Defaults are 32-MB linear memory, 25 million fuel units, one instance, one memory, two tables, a 30-second wall timeout, 1-MB input/output, and 2-MB host responses. Node manifests may request shorter timeouts, never longer than five minutes. Cancellation sets the execution flag and interrupts the store epoch.

Developer mode uses exactly the same limits and host broker. Its only differences are local publisher trust, hot reload, production-workspace disablement, export exclusion, and persistent Development labelling.
