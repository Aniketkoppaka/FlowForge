# Workflow Engine & Graph Contract (`docs/WORKFLOW-ENGINE.md`)

## 1. Graph Contract (`@flowforge/contracts`)

### Supported Node Types (`WorkflowNodeTypeEnum`)
1. `manual_trigger`: Entry point for workflow execution (`config: { description: string }`).
2. `http_request`: Outbound HTTP step (`config: { method, url, headers, body }`).
3. `condition`: Deterministic branching step (`config: { leftOperand, operator, rightOperand }`).
4. `data_transform`: Structured payload mapper (`config: { mappings: Array<{ id, sourcePath, targetKey }> }`).

### Draft Structural Validation vs. Execution Readiness

| Rule | Draft Save (`DraftDefinitionSchema`) | Publish / Execute (`validateWorkflowExecutionReadiness`) |
| :--- | :--- | :--- |
| `schemaVersion: 1` | Required | Required |
| Max 100 nodes / 200 edges | Required | Required |
| Unique node & edge IDs | Required | Required |
| Supported node types & finite coordinates | Required | Required |
| Valid edge source/target & handles | Required | Required |
| No incoming edges to `manual_trigger` | Required | Required |
| At most 1 incoming edge per node (no converging branches) | Required | Required |
| Acyclic graph (DAG — no self-loops or cycles) | Required | Required |
| `manual_trigger` count | $0$ or $1$ allowed | **Exactly $1$ required** (`MISSING_TRIGGER`) |
| Disconnected / unreachable nodes | Allowed during editing | **Rejected** (`DISCONNECTED_NODE`) |
| Incomplete node config fields (e.g. empty URL) | Allowed during editing | **Rejected** (`INCOMPLETE_NODE_CONFIG`) |

---

## 2. Deterministic Execution Model (`@flowforge/workflow-engine`)

1. **Upfront Validation & Immutability**:
   - `executeWorkflowGraph` runs `validateWorkflowExecutionReadiness(rawGraph)` before executing any node.
   - Deep-clones the graph and `triggerPayload` using `structuredClone` so caller objects are never mutated.
2. **Topological Traversal & Branch Propagation**:
   - Iterates through `validatedGraph.topologicalOrder` with a bounded step ceiling (`maxSteps = 100`).
   - Tracks edge activation (`PENDING` $\rightarrow$ `ACTIVE` | `INACTIVE`).
   - When a `condition` node completes with `selectedBranch: "true" | "false"`, only outgoing edges with `sourceHandle === selectedBranch` become `ACTIVE`. Non-matching outgoing edges become `INACTIVE`.
   - Any node whose incoming edge is `INACTIVE` is marked `SKIPPED` (with an explicit `skipReason`) and propagates `INACTIVE` to all of its outgoing edges.
3. **Failure Propagation**:
   - If an active node fails or throws, its status is recorded as `FAILED`, its outgoing edges are marked `INACTIVE` (preventing downstream nodes from executing with missing/broken state), and the overall workflow run status becomes `FAILED`.

---

## 3. Safe Data Path Resolution (`resolveDataPath`)

- **No `eval` or `new Function`**: Path resolution uses pure property lookup bounded by `MAX_DATA_PATH_DEPTH = 16` and `MAX_DATA_PATH_LENGTH = 500`.
- **Prototype Pollution Prevention**: Explicitly blocks `__proto__`, `prototype`, and `constructor` in both path segments and `data_transform` output keys, and verifies own properties via `Object.prototype.hasOwnProperty.call`.
- **Supported Namespaces**:
  - `trigger.payload.<path>` or `trigger.triggeredAt`
  - `nodes.<nodeId>.output.<path>`
  - `input.<path>` (direct upstream parent output)
  - `<relativePath>` (checks `input.<relativePath>` first, then `trigger.payload.<relativePath>`)
- **Missing Path Behavior**: Resolves deterministically to `{ found: false, value: undefined }`, which maps to `null` in `data_transform` outputs and `false` in `exists`/`equals`/`contains` condition checks.

---

## 4. Condition Operator Semantics (`evaluateConditionOperator`)

| Operator | Semantics |
| :--- | :--- |
| `exists` | `true` iff `leftOperand` path exists and its value is neither `undefined` nor `null`. |
| `equals` | `true` if string/primitive values match (e.g., `"enterprise" === "enterprise"`, `450` matches `"450"`, `true` matches `"true"`, `null` matches `"null"`). Missing/`undefined` values return `false`. |
| `not_equals` | Logical negation of `equals`. |
| `contains` | If `leftValue` is a `string`, checks substring inclusion. If `leftValue` is an `Array`, checks whether any element matches `rightOperand`. Otherwise `false`. |
