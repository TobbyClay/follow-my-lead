# Delivery roadmap

The roadmap focuses on teaching and reliably replaying Chrome workflows. The initial implementation and local tests now exist; real Chrome acceptance and a user-selected real workflow remain outstanding. Later stages below are planned.

## Foundation

Completed: implement a versioned workflow model and validator, and separate browser-specific recording and DOM execution from shared data and input logic.

Compatibility fixtures verify that the Chrome runner rejects unsupported capabilities before executing a workflow.

Acceptance: the core can describe supported browser workflows and reject unavailable capabilities clearly before execution.

## Browser teaching and replay

Implemented: extension recording, success markers, draft editing, reusable inputs, workflow import/export, a project skill for AI interpretation, and local replay with assertions. Local DOM and simulated transport tests pass. The current adapter uses synthetic DOM events and supports one origin and top-level tab. No direct AI API calls or browser model recovery are implemented.

Version 0.2 implements manual-versus-caused navigation, SPA URL checkpoints, suggested input and outcome bindings, changing query parameters, a two-demonstration comparison, plain-language teach-back, and revision-bound verification after a different-input test. Regression fixtures cover customer lookup and an unrelated schedule/date workflow; broad real-site compatibility is still unproven.

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

## Browser release

Extend the validated path to a small set of real workflows. Add workflow editing, input forms, a library, run history, cancellation, and recovery at known checkpoints. Add multi-tab and multi-site handling only as supported by the chosen session and permission model.

Acceptance: publish the supported workflows and measured completion results across repeated trials, including changed inputs and realistic delays. Preserve saved workflows through schema changes or provide a documented migration.
