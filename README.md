# Follow My Lead

Teach a repeatable task by demonstrating it, review what the system learned, and run it again with new inputs.

## Product direction

One product with two capability levels, delivered in order. Desktop support is an explicit project objective and shapes the shared design from the beginning. These levels describe capabilities, not subscription or pricing tiers.

| | Level 1: Browser | Level 2: Desktop |
| --- | --- | --- |
| Initial environment | Chrome websites and browser workflows | Windows applications, files, and workflows that cross application boundaries |
| User experience | Demonstrate, review, save, run | The same experience, extended to desktop applications |
| Observation | Page structure, interaction events, selected screenshots | Accessibility information, window context, interaction events, selected screenshots |
| Execution | Browser adapter | Windows adapter alongside the browser adapter |
| Shared foundation | Workflow format, learning, parameters, library, execution state, outcome checks | Reuses the same foundation and browser workflows |

For example, Level 1 could learn how to filter a web report and download the result. Level 2 could extend that workflow to open the downloaded file in a desktop application, perform a demonstrated transformation, and return to the browser.

Both levels aim to learn reusable operations and their outcomes. A demonstration is the starting point; the user can correct inferred steps and identify which values should change between runs.

## Current status

The first Chrome prototype is implemented: a Manifest V3 extension records demonstrations, drafts and edits parameterized workflows, imports AI-authored workflows, and replays them with a final success check. A project skill lets Codex interpret recordings using the host's model. The extension itself makes no AI API calls.

The code is verified with local DOM and simulated Chrome-transport tests. Installation, permissions, and real-site behavior still need a live Chrome check. Desktop control and automatic model recovery inside the extension remain future work.

## Try it

1. In Chrome, open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select this project's `extension` folder.
2. In a terminal in this project, run `npm run demo` (or `npm.cmd run demo` in PowerShell). Node.js 22+ is required for the practice server; the extension itself needs no Node installation.
3. Open [the local practice directory](http://127.0.0.1:8765/). Open Follow My Lead from Chrome's extension button.
4. Name the task **Find a customer** and describe the goal: **Search for the requested customer and show exactly one result**. Start teaching and allow access to this local site.
5. Search for **Maya**. Reopen the extension, choose **Mark success**, and click **1 customer found** on the page. Use the recording banner's **Stop** button or reopen the extension and stop.
6. Choose **Create local draft**. On the recorded fill step, enable **Change this value on each run** and name the input `customerName`. Review the final success check, check the review box, and save.
7. Under the saved task, change the input to **Noah**, then run it. The extension opens a new tab, performs the task, and verifies the result.

For a quick replay-only check, import `examples/find-customer.workflow.json`, review it, save it, and run with Maya or Noah. A name that does not exist should fail the final assertion.

**Expand** opens a larger workspace for editing. Start a recording from the extension popup on the target website so Chrome can grant it access to that tab. Keep Chrome and the practice server open while replaying the local example.

## Let AI learn the task

The local draft builder organizes events; it does not interpret them with a model. For actual AI learning:

1. Stop recording and choose **Export for AI**. Review the exported file if it contains private business data.
2. In this Codex project, invoke `$follow-my-lead`, attach the `.recording.json`, and explain what should vary between runs. **Copy teaching prompt** provides a starting prompt.
3. The skill interprets the evidence, identifies inputs and assumptions, and writes a validated workflow to `workflows/`.
4. Import the `.workflow.json` into the extension, review it, and run.

For an adaptive run, invoke the skill in a host with a connected browser and ask it to run the task. The AI can inspect changes and adapt there, subject to its available tools and usage limits. A skill alone does not connect to local Chrome. For Codex's browser connection, use **Settings → Computer use**; that ChatGPT browser extension is separate from the Follow My Lead recorder.

With Codex signed in through ChatGPT, model use follows the subscription. Recording and deterministic extension replay need no API credits. This is not a way for an independent service to spend a user's subscription as API credits. See [skill execution and costs](docs/skill-and-costs.md).

## Scope of this pilot

Supported: one website origin, one top-level tab, standard HTML inputs and selects, checkboxes, clicks, simple Enter submission, page navigation within the site, and text/value assertions. The recorder observes interaction events and page structure; continuous screen/video recording is not included.

The adapter dispatches DOM interactions. Sites requiring trusted OS input, embedded cross-origin frames, shadow DOM controls, canvas interfaces, native file dialogs, or new-tab flows may need a different browser driver. Such compatibility has not been established. Keep authentication outside recordings; detected sensitive fields are excluded, and resulting learning gaps block replay.

Unexpected states stop replay. Model-based recovery, branching/loops in the local runner, scheduling, multi-application workflows, and desktop control are not implemented.

## Development

```sh
npm install
npm test
npm run check
node scripts/fml.mjs validate examples/find-customer.workflow.json
```

Runtime extension code has no third-party dependencies. `jsdom` is a development dependency for testing. Test coverage includes recording/replay with a changed input, outcome failures, ambiguity, sensitive values, cancellation, worker orchestration and interruption, and skill export. These are not substitutes for live Chrome testing.

Useful commands:

```sh
node scripts/fml.mjs draft recordings/task.recording.json workflows/task.workflow.json
node scripts/fml.mjs export-skill workflows/task.workflow.json path/to/a/new-skill-directory
```

Draft output files and skill export destinations must be new; commands do not overwrite existing files. Recordings, local workflow outputs, and generated artifacts are ignored by Git. The example in `examples/` contains fictional data.

## Project references

- [Architecture](docs/architecture.md) defines the shared core and environment adapters.
- [Roadmap](docs/roadmap.md) defines delivery stages and acceptance criteria.

- [Project skill](.agents/skills/follow-my-lead/SKILL.md) provides the AI teaching and adaptive execution instructions.
- [Implemented workflow format](.agents/skills/follow-my-lead/references/workflow-format.md) documents the current JSON contract.

## Design commitments

- Keep browser and Windows APIs inside their respective adapters.
- Save versioned workflows whose steps identify their application context explicitly.
- Keep observed evidence separate from the reviewed, executable workflow.
- Preserve browser workflows when desktop support is introduced.
- Add application-specific capabilities without forcing every adapter to support them.
- Measure success by the resulting application state, not merely by whether clicks were dispatched.
- Treat broad desktop compatibility as a progressively tested capability; never promise support for every application.
