# Follow My Lead v1

A workflow is JSON with `schemaVersion: 1`, `kind: "workflow"`, a safe identifier `id`, positive integer `revision`, `name`, `goal`, `contexts`, `inputs`, and ordered `steps`. The first step is `navigate`; the last is `assertText` or `assertValue`. The implemented validator is `extension/core/workflow.js` in the project root.

Use `contexts: { "main": { "adapter": "browser", "origin": "https://example.com" } }`. Origin is exact: scheme, host, and optional port, with no trailing slash. This extension supports one origin and one tab per run.

Inputs are an object of named definitions, e.g. `customerName: { "type": "string", "default": "Maya", "required": true }`. Types are string and boolean. A step's `value` is a literal or exactly `{ "input": "customerName" }`; template strings are not interpolated. An absent default means the caller must supply a value. Do not put credentials in inputs.

Each step has a unique `id`, `context: "main"`, and an `action`:

| Action | Other fields |
| --- | --- |
| `navigate` | `url`: an HTTP(S) URL in the context origin |
| `waitForURL` | `url`: the exact expected HTTP(S) URL in the context origin; waits without navigating again |
| `fill` | `target`, string `value` |
| `select` | `target`, string `value` equal to an option's underlying value |
| `check` | `target`, boolean `value` |
| `click` | `target` |
| `press` | `target`, `key: "Enter"`; other keys are not implemented in the Chrome pilot |
| `assertText` | `target`, string `value`, `match: "equals"` or `"contains"` |
| `assertValue` | `target`, string `value`; checks the exact control value |

Every action except `navigate` and `waitForURL` needs a target: `{ "description": "Customer name", "locators": [{ "kind": "label", "value": "Customer name" }, { "kind": "css", "value": "#customer-name" }] }`.

Navigation steps may have `queryInputs: { "q": "searchTerm" }`. Each key must already exist as a query parameter in `url`; each value names a string input. Replay replaces that query value using URL encoding without changing the origin or path. URL templates, dynamic path segments, and arbitrary string interpolation are not implemented. Preserve unresolved dynamic path requirements as learning gaps.

Locator kinds: `label` matches accessible/form label text; `role` requires `role` and exact name `value`; `css` matches a CSS selector; `text` matches exact normalized visible text. Prefer named controls and stable attributes. The resolver tries ordered alternatives but rejects multiple matches; it does not use a positional fallback to guess among ambiguous semantic targets. Keep success locators stable when expected text changes.

Optional `timeoutMs` is 100–30000. Defaults are 8 seconds for targets and assertions. A click dispatch is not success; a final assertion is required. Avoid empty or always-true checks. The runner does not evaluate arbitrary JavaScript or dynamic loops.

`learning` holds `method`, `reviewed`, `sourceRecording`, optional `summary`, arrays `assumptions`, `decisionRules`, `unresolved`, and `demonstrationInputs` (observed literal values keyed by input name). Use `method: "codex-skill"` for AI interpretation in this host. Newly learned workflows start with `reviewed: false`. Resolve every `unresolved` item before replay. Keep unknown branches explicit rather than inventing them. Local comparison evidence may appear in `learning.comparison`; `fixedStepIds` records values the user elected to keep fixed.

Reference the project example at `examples/find-customer.workflow.json` when an end-to-end specimen is useful; its count and customer-name checks are both required. Recorded navigation events include `navigation.kind` (`explicit`, `observed`, or `unknown`), `source`, and, when known, `causeEventId`. Manual visits/reloads become `navigate`; caused transitions become `waitForURL`. Unknown causes block local-draft replay until reviewed. Missing transitions, unsupported operations, and leaving the approved origin are gaps, not events to silently discard. Initial navigation resets the task to its demonstrated entry point.

Suggestions use the recorded controls, not site-specific dictionaries. Acceptance turns the chosen values into inputs and can link matching independent result markers and query parameters. Review those proposed links. An assertion against the input field itself is not independent outcome evidence.

Structural validity, user review, a passing run, and verified transfer are distinct. `RUN` with `mode: "test"` requires at least one used input different from its demonstrated value and independent assertions linked to every changed input. A passing test creates local proof tied to the saved revision and definition fingerprint. Failed/stopped tests do not verify the task, importing claims cannot verify it, and saving an edit invalidates prior proof. One passing case does not prove unseen branches or all inputs. Boolean inputs cannot currently be covered by the string-only outcome assertions; keep that transfer-testing limitation explicit.

A recording contains `name`, `goal`, `startUrl`, `origin`, initial `observation`, `events`, and `warnings`. Events include action, target, timestamp, URL, page title, and optional value. `redacted: true` means a field was excluded; do not guess its value. Raw records and workflow outputs are ignored by Git by default.
