# Delivery roadmap

Browser support is the first usable release. Desktop support is the second product level. Both use the shared architecture from the outset. The initial Chrome implementation and local tests now exist; real Chrome acceptance and a user-selected real workflow remain outstanding. Later stages below are planned.

## 0. Foundation

Completed: document the two levels, implement a versioned workflow model and validator, and separate browser-specific recording and DOM execution from shared data and input logic.

A desktop-shaped fixture verifies capability rejection by the Chrome runner. It validates the core boundary only; it does not establish Windows compatibility. The broader cross-adapter runner remains future work.

Acceptance: the core can describe a browser-only workflow and a workflow containing browser and desktop steps. It rejects unavailable capabilities clearly before execution.

## 1. Browser teaching and replay

Implemented: extension recording, success markers, draft editing, reusable inputs, workflow import/export, a project skill for AI interpretation, and local replay with assertions. Local DOM and simulated transport tests pass. The current adapter uses synthetic DOM events and supports one origin and top-level tab. No direct AI API calls or browser model recovery are implemented.

Remaining acceptance: load in Chrome, check permission/navigation behavior, then teach and verify a real user task. The required ChatGPT browser connection was unavailable during implementation; live extension testing is not yet claimed.

Choose one short, repeatable Chrome workflow with an observable outcome. A test web page with a search field and results is an appropriate initial fixture; a real user workflow should follow.

Deliver the teaching flow: start recording, perform the task, stop, review the proposed steps, identify an input, save the workflow, and run it with a different input.

Use this stage to validate the browser recording/execution transport and session model. Include clicks, text entry, navigation, waits, and explicit result checks. Model integration follows a validated recording format and remains replaceable.

Acceptance:

- Capture and review a complete demonstration with application context intact.
- Replay with a different input and verify the actual outcome.
- Save and reload the workflow without relying on stale runtime tab or element handles.
- Handle a page reload and a changed element position on the pilot workflow.
- Pause with a useful explanation when a target is ambiguous or an expected state does not appear.
- Report actual model usage when an API is used, providing a basis for cost estimates.

## 2. Browser release

Extend the validated path to a small set of real workflows. Add workflow editing, input forms, a library, run history, cancellation, and recovery at known checkpoints. Add multi-tab and multi-site handling only as supported by the chosen session and permission model.

Acceptance: publish the supported workflows and measured completion results across repeated trials, including changed inputs and realistic delays. Preserve saved workflows through schema changes or provide a documented migration.

## 3. Windows desktop pilot

Implement the Windows companion and adapter. Start with one native application whose controls can be inspected through UI Automation. Record a short task, review it through the shared teaching flow, and execute it through the shared runner.

Deliver window binding, target resolution, text and pointer operations, state checks, and stop behavior. Add screen-based targeting only where required by the pilot, then test the relevant display layouts.

Acceptance:

- Complete the demonstrated native application workflow with a new input.
- Verify behavior after moving and resizing the application window.
- Identify missing controls and lost application context instead of continuing in the wrong window.
- Keep existing browser workflows working through the same workflow core.
- Establish a documented installation and update path for the companion.

## 4. Workflows across applications

Compose browser and Windows steps in one workflow. Use a concrete pilot such as downloading a report, opening it in a native application, performing a demonstrated operation, and returning a result to a browser task.

Acceptance: pass typed data and file references between adapters, verify each application transition, and resume a paused workflow without duplicating completed effects.

Grow desktop coverage through a compatibility matrix of tested applications and workflows. Broad coverage comes from additional adapters, targeting methods, and validation. Support for every desktop application is not a release promise.
