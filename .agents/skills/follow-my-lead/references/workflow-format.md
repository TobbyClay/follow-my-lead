# Follow My Lead v1

A workflow is JSON with `schemaVersion: 1`, `kind: "workflow"`, a safe identifier `id`, positive integer `revision`, `name`, `goal`, `contexts`, `inputs`, and ordered `steps`. The first step is `navigate`; the last is `assertText` or `assertValue`. The implemented validator is `extension/core/workflow.js` in the project root.

Use `contexts: { "main": { "adapter": "browser", "origin": "https://example.com" } }`. Origin is exact: scheme, host, and optional port, with no trailing slash. This extension supports one origin and one tab per run. Native applications require a future adapter.

Inputs are an object of named definitions, e.g. `customerName: { "type": "string", "default": "Maya", "required": true }`. Types are string and boolean. A step's `value` is a literal or exactly `{ "input": "customerName" }`; template strings are not interpolated. An absent default means the caller must supply a value. Do not put credentials in inputs.

Each step has a unique `id`, `context: "main"`, and an `action`:

| Action | Other fields |
| --- | --- |
| `navigate` | `url`: an HTTP(S) URL in the context origin |
| `fill` | `target`, string `value` |
| `select` | `target`, string `value` equal to an option's underlying value |
| `check` | `target`, boolean `value` |
| `click` | `target` |
| `press` | `target`, `key: "Enter"`; other keys are not implemented in the Chrome pilot |
| `assertText` | `target`, string `value`, `match: "equals"` or `"contains"` |
| `assertValue` | `target`, string `value`; checks the exact control value |

Every action except navigation needs a target: `{ "description": "Customer name", "locators": [{ "kind": "label", "value": "Customer name" }, { "kind": "css", "value": "#customer-name" }] }`.

Locator kinds: `label` matches accessible/form label text; `role` requires `role` and exact name `value`; `css` matches a CSS selector; `text` matches exact normalized visible text. Prefer named controls and stable attributes. The resolver tries ordered alternatives but rejects multiple matches; it does not use a positional fallback to guess among ambiguous semantic targets. Keep success locators stable when expected text changes.

Optional `timeoutMs` is 100–30000. Defaults are 8 seconds for targets and assertions. A click dispatch is not success; a final assertion is required. Avoid empty or always-true checks. The runner does not evaluate arbitrary JavaScript or dynamic loops.

`learning` holds `method`, `reviewed`, `sourceRecording`, and optional arrays `assumptions`, `decisionRules`, `unresolved`. Use `method: "codex-skill"` for AI interpretation in this host. Newly learned workflows start with `reviewed: false`. Resolve every `unresolved` item before replay. Keep unknown branches explicit rather than inventing them.

Reference the project example at `examples/find-customer.workflow.json` when an end-to-end specimen is useful. Recorded navigate events after clicks describe resulting page transitions; adding a second explicit navigation can duplicate or skip the result of a click. Initial navigation resets the task to its demonstrated entry point.

A recording contains `name`, `goal`, `startUrl`, `origin`, initial `observation`, `events`, and `warnings`. Events include action, target, timestamp, URL, page title, and optional value. `redacted: true` means a field was excluded; do not guess its value. Raw records and workflow outputs are ignored by Git by default.
