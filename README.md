# Follow My Lead

Teach a repeatable task by demonstrating it, review what the system learned, and run it again with new inputs.

## Product direction

Follow My Lead helps users teach repeatable Chrome workflows by demonstrating them. The extension captures page structure and interaction events, while a Codex skill interprets the demonstration and turns it into reusable instructions.

The workflow is simple: demonstrate a task, review the learned steps, identify changing inputs, save it, and run it again with a verified result.

For example, demonstrate how to find a customer in a web directory, make the customer name an input, and repeat the task for another customer.

A demonstration is the starting point; users can correct inferred steps and define the result that proves a run succeeded.

## Current status

The Chrome prototype now preserves manual and action-driven navigation, suggests reusable inputs from observed controls, compares two demonstrations, and explains what was learned before review. It imports AI-authored workflows and replays reviewed tasks with explicit outcome checks. A project skill lets Codex interpret recordings using the host's model. The extension itself makes no AI API calls.

Learning is website-independent: there are no customer-directory-specific rules in the recorder or learner. Each task is taught against its own website and controls. This does not mean every website or browser capability is supported; see the compatibility limits below.

Structural validity, user review, a passing run, and verified transfer are separate. A task earns **Verified** only when a different-input test passes independent outcome checks tied to those changed inputs. Verification belongs to that saved revision; edits require a new test, and imported JSON cannot claim verification.

The code is verified with local DOM and simulated Chrome-transport tests. Installation, permissions, and real-site behavior still need a live Chrome check. Automatic model recovery inside the extension remains future work.

## Try it

1. In Chrome, open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select this project's `extension` folder.
2. In a terminal in this project, run `npm run demo` (or `npm.cmd run demo` in PowerShell). Node.js 22+ is required for the practice server; the extension itself needs no Node installation.
3. Open [the local practice directory](http://127.0.0.1:8765/). Open Follow My Lead from Chrome's extension button.
4. Name the task **Find a customer** and describe the goal: **Find exactly one result and confirm it is the requested customer**. Start teaching and allow access to this local site.
5. Search for **Maya**. Reopen the extension, choose **Mark success**, and click **1 customer found**. Use **Mark success** again and click the returned customer's name, **Maya Chen**. Stop recording.
6. Choose **Create local draft**. Accept the suggested **Customer name** input and its linked result check; rename it if desired. Review **What I learned**, expand the individual steps if needed, check the review box, and save.
7. Under the saved task, change the input to **Noah**, then choose **Test with different input**. The extension opens a new tab and checks both the result count and the requested name before verifying the saved revision.

Optionally record the task again with another input and select it under **Compare with a second demonstration** before drafting. Matching paths expose changing fields and likely fixed settings; different paths remain review gaps rather than inferred branches.

For a quick replay-only check, import `examples/find-customer.workflow.json`, review it, save it, and run with Maya or Noah. A missing or wrong customer fails the outcome checks, even if a generic count looks correct. A normal run does not create new transfer-verification evidence.

**Expand** opens a larger workspace for editing. Start a recording from the extension popup on the target website so Chrome can grant it access to that tab. Keep Chrome and the practice server open while replaying the local example.

## Let AI learn the task

The local draft builder organizes events; it does not interpret them with a model. For actual AI learning:

1. Stop recording and choose **Export for AI**. Review the exported file if it contains private business data.
2. In this Codex project, invoke `$follow-my-lead`, attach the `.recording.json`, and explain what should vary between runs. **Copy teaching prompt** provides a starting prompt.
3. The skill interprets the evidence, identifies inputs and assumptions, explains the learned rules, and writes a validated workflow to `workflows/`. Attach both recordings when asking for comparison.
4. Import the `.workflow.json`, review its teach-back and input-linked outcomes, then test it with a different input. The AI explanation is distinct from a verified browser run.

For an adaptive run, invoke the skill in a host with a connected browser and ask it to run the task. The AI can inspect changes and adapt there, subject to its available tools and usage limits. A skill alone does not connect to local Chrome. For Codex's browser connection, use **Settings → Computer use**; that ChatGPT browser extension is separate from the Follow My Lead recorder.

With Codex signed in through ChatGPT, model use follows the subscription. Recording and deterministic extension replay need no API credits. This is not a way for an independent service to spend a user's subscription as API credits. See [skill execution and costs](docs/skill-and-costs.md).

## Scope of this pilot

Supported on ordinary HTTP(S) websites: one website origin per workflow, one top-level tab, standard HTML inputs and selects, checkboxes, clicks, simple Enter submission, manual visits/reloads, action-driven page transitions (including observed history/hash changes), query-parameter inputs, and text/value assertions. Chrome's navigation permission observes navigation only for the actively recorded top-level tab; site content still requires per-host permission. The recorder observes interaction events and page structure; continuous screen/video recording is not included.

Unknown navigation causes and missing transitions block local-draft replay until reviewed. Leaving the approved site or opening a new tab stops recording with a gap. Dynamic URL path inputs, templates, cross-site workflows, and general branching/loops are not implemented. Changed-input verification currently needs string-based independent result assertions; boolean-only tasks need additional outcome capabilities before they can earn that verification label.

The adapter dispatches DOM interactions. Sites requiring trusted OS input, embedded cross-origin frames, shadow DOM controls, canvas interfaces, native file dialogs, or new-tab flows may need a different browser driver. Such compatibility has not been established. Keep authentication outside recordings; detected sensitive fields are excluded, and resulting learning gaps block replay.

Unexpected states stop replay. Model-based recovery, branching/loops in the local runner, and scheduling are not implemented.

## Development

```sh
npm install
npm test
npm run check
node scripts/fml.mjs validate examples/find-customer.workflow.json
```

Runtime extension code has no third-party dependencies. `jsdom` is a development dependency for testing. Test coverage includes recording/replay with a changed input, outcome failures, ambiguity, sensitive values, cancellation, worker orchestration and interruption, and skill export. These are not substitutes for live Chrome testing.

`npm run preview` serves the review UI at `http://127.0.0.1:8766/` with fictional demonstrations and an explicitly simulated storage transport. It cannot record, replay, or earn verification; use it only for interface development. Real extension testing still requires loading the `extension` directory in Chrome. Reload an existing installation for version 0.2 and review Chrome's new navigation-permission prompt.

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

- Keep browser APIs inside the execution adapter.
- Save versioned workflows whose steps identify their application context explicitly.
- Keep observed evidence separate from the reviewed, executable workflow.
- Preserve saved workflows through versioned format changes.
- Add application-specific capabilities without forcing every adapter to support them.
- Measure success by the resulting application state, not merely by whether clicks were dispatched.
- Describe website compatibility through tested workflows and verified outcomes.
