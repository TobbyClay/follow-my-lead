# Architecture

Status: Chrome prototype implemented, 2026-09-03. This document describes the broader design. The current concrete JSON contract is documented in the project skill's [workflow format](../.agents/skills/follow-my-lead/references/workflow-format.md); the earlier illustrative contract below is not the implemented schema.

The pilot uses a Chrome extension, a portable core in `extension/core/`, and a DOM adapter in `extension/browser/`. Its service worker coordinates recording and replay and persists action intent before dispatch. AI learning is supplied by the host through the project skill. There is no direct model API backend, desktop adapter, or automatic model recovery in the extension.

## One core with environment adapters

The core owns the teaching and execution process. Adapters supply observations and perform actions in particular environments. Chrome is the first adapter; Windows desktop is the second. A desktop workflow may use both.

```text
Demonstrate -> Review learned steps -> Save workflow -> Run -> Check outcome
                         Shared workflow core
                                  |
                     +------------+------------+
                     |                         |
                Browser adapter          Windows adapter
                Chrome websites          Native applications
```

The shared core must not depend on the DOM, Chrome extension APIs, Playwright objects, Windows handles, or UI Automation objects. Platform observations cross the boundary as serializable data. Runtime handles stay inside adapters.

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

The core understands the action, parameter, context, and condition. The browser adapter interprets `browser.label`. A Windows target might use an accessibility identifier and application binding instead. Locators are scoped to an application context and can have reviewed alternatives; absolute screen coordinates are insufficient as a durable target definition.

Portability means the workflow engine and format support multiple environments. It does not mean that browser locators automatically work in a native application. Supporting the same business operation in a different application requires its own bindings or demonstrated steps.

Steps can expose typed outputs such as text, a table, or a file reference. Later steps consume those outputs through references rather than embedding platform-specific objects. This preserves a route from browser downloads to desktop file processing.

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

Before a run, the core checks that available adapters support its required capabilities. Missing desktop support is reported before a mixed workflow starts. An application change can still cause a runtime failure, which must be reported accurately.

An ambiguous or missing target pauses the run. The runner does not blindly repeat an action whose result is unknown: it checks the resulting state first, particularly for submissions and file operations. Outcome checks are separate from successful dispatch of an input event.

## Browser delivery

Use a Chrome extension to collect page structure and demonstrated interaction events. Scope initial recording to a user-selected site and short workflows. Chrome's `activeTab` access is temporary and does not automatically extend to a different origin; multi-site recording therefore needs an explicit site-access design.

The first spike implements extension-based DOM execution in the current Chrome profile, with a new tab for each run. Site access is requested for the selected host, with exact-origin checks in the workflow and adapter. Dynamically registered scripts reconnect on same-site page loads. Synthetic DOM interactions are sufficient for the practice fixture; sites requiring trusted input will need a different driver. Live Chrome compatibility is still to be checked. Injecting content scripts alone is not evidence that all browser interactions can be replayed.

Keep any local browser runner separate from the shared workflow model. The final transport choice should not dictate the workflow format or require native desktop control for users who only use browser workflows.

## Desktop delivery

Add a companion application that runs in the signed-in Windows user session. Its adapter uses Windows UI Automation where applications expose controls and adds screen-based targeting for applications that need it. Desktop work also introduces window focus, display scaling, file dialogs, and coordination of mouse and keyboard access.

Chrome native messaging is a possible bridge between the extension and the installed companion. It requires a registered native host; a Chrome extension alone does not become a general desktop controller. Transport details remain outside the workflow format.

An application exposing little accessibility information will need more visual interpretation and targeted compatibility work. Protected operating-system surfaces are outside ordinary automation scope. Windows is the first desktop target; macOS and Linux would need their own adapters.

## Data boundaries

Record only during a visible teaching session. Keep recordings and run artifacts local by default; a cloud model integration explicitly defines which redacted evidence it sends. Store credential references separately from workflow values. User review distinguishes reusable inputs from demonstration-specific values before a workflow is saved.

## Primary references

- [Chrome activeTab permissions](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab)
- [Chrome content scripts](https://developer.chrome.com/docs/extensions/reference/manifest/content-scripts)
- [Chrome native messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)
- [Windows UI Automation](https://learn.microsoft.com/en-us/windows/win32/winauto/entry-uiauto-win32)
