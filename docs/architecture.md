# Architecture

Status: Chrome prototype implemented, 2026-09-03. This document describes the broader design. The current concrete JSON contract is documented in the project skill's [workflow format](../.agents/skills/follow-my-lead/references/workflow-format.md); the earlier illustrative contract below is not the implemented schema.

The pilot uses a Chrome extension, a portable core in `extension/core/`, and a DOM adapter in `extension/browser/`. Its service worker coordinates recording and replay and persists action intent before dispatch. AI learning is supplied by the host through the project skill. There is no direct model API backend or automatic model recovery in the extension.

## One core with environment adapters

The core owns the teaching and execution process. The browser adapter supplies observations and performs actions in Chrome, keeping browser-specific operations separate from workflow data and input logic.

```text
Demonstrate -> Review learned steps -> Save workflow -> Run -> Check outcome
                         Shared workflow core
                                  |
                           Browser adapter
                           Chrome websites
```

The shared core must not depend on the DOM, Chrome extension APIs, or Playwright objects. Browser observations cross the boundary as serializable data. Runtime handles stay inside adapters.

## Shared concepts

| Concept | Responsibility |
| --- | --- |
| Recording | Ordered observations and user actions, with timestamps, application context, and references to selected evidence |
| Learner | Turns a recording into proposed steps, input parameters, and outcome checks; identifies uncertainty for review |
| Workflow | Versioned, reviewed instructions with application contexts, required capabilities, steps, and inputs |
| Runner | Resolves inputs, dispatches steps to adapters, manages progress and pause/resume, and evaluates outcomes |
| Library | Stores workflows and their revisions independently of the recording or execution platform |
| Run record | Tracks attempted actions, observed results, unresolved steps, and workflow revision |

The model provider is a replaceable dependency of the learner and any optional recovery logic. An existing model interprets demonstrations; custom model training is not required for the initial product. Capturing a recording does not require continuous model calls.

## Workflow boundary

Every workflow has a schema version and a revision. Every step identifies a named application context and a required capability. Initial common action families are activate, click, enter text, select, scroll, wait for a condition, and read a value. Navigation, downloads, opening files, and other specialized operations are capabilities that adapters can add.

The following illustrates a browser step. It is an example of the intended structure, not an executable schema:

```json
{
  "schemaVersion": 1,
  "revision": 1,
  "id": "search-customer",
  "inputs": { "customerName": { "type": "string" } },
  "contexts": {
    "customerPortal": {
      "adapter": "browser",
      "binding": { "origin": "https://example.com" }
    }
  },
  "steps": [
    {
      "id": "enter-customer",
      "context": "customerPortal",
      "capability": "text.enter",
      "target": {
        "description": "Customer search field",
        "locator": {
          "kind": "browser.label",
          "value": "Customer name"
        }
      },
      "value": { "input": "customerName" },
      "expected": {
        "condition": "target.valueEquals",
        "value": { "input": "customerName" },
        "timeoutMs": 5000
      }
    }
  ]
}
```

The core understands the action, parameter, context, and condition. The browser adapter interprets `browser.label`. Locators are scoped to a website context and can have reviewed alternatives; absolute screen coordinates are insufficient as a durable target definition.

The workflow format keeps browser-driver details separate from the task definition. Supporting the same operation on a different website requires its own bindings or demonstrated steps.

Steps can expose typed outputs such as text, a table, or a file reference. Later steps consume those outputs through references rather than embedding browser-specific objects.

## Adapter contract

Each adapter reports its version and capabilities and implements these operations:

| Operation | Meaning |
| --- | --- |
| Observe | Return current application context and relevant UI state; attach evidence references when needed |
| Record | Emit normalized observations of demonstrated actions, keeping the original evidence separately |
| Resolve | Locate a target within its bound context; report found, missing, or ambiguous |
| Execute | Perform one supported action and report its attempt identifier and immediate result |
| Verify | Evaluate the expected application state within a bounded timeout |
| Stop | Cancel queued work and report whether an already dispatched action has completed |

Before a run, the core checks that the available browser adapter supports its required capabilities. Unsupported workflows are rejected before execution. A website change can still cause a runtime failure, which must be reported accurately.

An ambiguous or missing target pauses the run. The runner does not blindly repeat an action whose result is unknown: it checks the resulting state first, particularly for submissions and file operations. Outcome checks are separate from successful dispatch of an input event.

## Browser delivery

Use a Chrome extension to collect page structure and demonstrated interaction events. Scope initial recording to a user-selected site and short workflows. Chrome's `activeTab` access is temporary and does not automatically extend to a different origin; multi-site recording therefore needs an explicit site-access design.

The first spike implements extension-based DOM execution in the current Chrome profile, with a new tab for each run. Site access is requested for the selected host, with exact-origin checks in the workflow and adapter. Dynamically registered scripts reconnect on same-site page loads. Synthetic DOM interactions are sufficient for the practice fixture; sites requiring trusted input will need a different driver. Live Chrome compatibility is still to be checked. Injecting content scripts alone is not evidence that all browser interactions can be replayed.

Keep any local browser runner separate from the shared workflow model. The final transport choice should not dictate the workflow format.

## Data boundaries

Record only during a visible teaching session. Keep recordings and run artifacts local by default; a cloud model integration explicitly defines which redacted evidence it sends. Store credential references separately from workflow values. User review distinguishes reusable inputs from demonstration-specific values before a workflow is saved.

## Primary references

- [Chrome activeTab permissions](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab)
- [Chrome content scripts](https://developer.chrome.com/docs/extensions/reference/manifest/content-scripts)
