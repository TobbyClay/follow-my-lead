import test from "node:test";
import assert from "node:assert/strict";
import { draftWorkflow, materialize, resolveInputs, validateBrowserRun } from "../extension/core/workflow.js";
import { acceptInput, createTeachingDraft, suggestInputs } from "../extension/core/learning.js";
import { page, attachContent, enter, demoJS, example } from "./helpers.mjs";

test("record, parameterize, serialize, and replay against a new document with a changed layout", async () => {
  const first = page(); const window = first.window; window.eval(demoJS);
  const events = [];
  const recorder = new window.FMLRecorder(event => events.push(event), { trustedOnly: false });
  recorder.start();
  const input = window.document.getElementById("customer-name");
  enter(window, input, "Ma"); enter(window, input, "Maya");
  window.document.querySelector("button[type='submit']").click();
  await new Promise(resolve => setTimeout(resolve, 300));
  recorder.successMode = true;
  window.document.getElementById("result-count").click(); recorder.stop();
  assert.deepEqual(events.map(event => event.action), ["fill", "click", "assertText"]);
  assert.equal(events[0].value, "Maya");
  assert.equal(events[0].target.locators[0].kind, "label");
  const recording = { schemaVersion: 1, kind: "recording", id: "test", name: "Find customer", goal: "Find exactly one matching customer", startUrl: window.location.href, events };
  const draft = draftWorkflow(recording);
  draft.inputs.customerName = { type: "string", default: "Maya", required: true };
  draft.steps[1].value = { input: "customerName" }; draft.learning.reviewed = true;
  const persisted = JSON.parse(JSON.stringify(draft));
  assert.deepEqual(validateBrowserRun(persisted), []);
  first.window.close();
  const second = page(); second.window.eval(demoJS);
  second.window.document.body.classList.add("shifted");
  // A new wrapper and panel alter the layout while semantic targets remain stable.
  const secondInput = second.window.document.getElementById("customer-name");
  const spacer = second.window.document.createElement("div"); spacer.textContent = "New panel above the search";
  secondInput.parentElement.before(spacer);
  const execute = attachContent(second);
  const inputs = resolveInputs(persisted, { customerName: "Noah" });
  for (const step of persisted.steps.slice(1)) {
    const result = await execute({ type: "EXECUTE", step: materialize(step, inputs), origin: second.window.location.origin });
    assert.equal(result.ok, true, JSON.stringify(result));
  }
  assert.match(second.window.document.getElementById("customers").textContent, /Noah Silva/);
  assert.doesNotMatch(second.window.document.getElementById("customers").textContent, /Maya Chen/);
  second.window.close();
});

test("an incorrect result fails its assertion and is not reported as successful", async () => {
  const dom = page(); dom.window.eval(demoJS); const execute = attachContent(dom);
  const inputs = resolveInputs(example, { customerName: "Does not exist" });
  for (const step of example.steps.slice(1, 3)) assert.equal((await execute({ type: "EXECUTE", step: materialize(step, inputs), origin: dom.window.location.origin })).ok, true);
  const assertion = { ...materialize(example.steps[3], inputs), timeoutMs: 500 };
  const result = await execute({ type: "EXECUTE", step: assertion, origin: dom.window.location.origin });
  assert.equal(result.ok, false); assert.match(result.error, /Success check failed/); dom.window.close();
});

test("sensitive input and select values are excluded at capture time", () => {
  const dom = page('<label for="password">Password</label><input id="password" type="password"><label for="api-token">API token</label><select id="api-token"><option value="very-secret">Account</option></select>');
  const events = []; const recorder = new dom.window.FMLRecorder(event => events.push(event), { trustedOnly: false }); recorder.start();
  enter(dom.window, dom.window.document.querySelector("input"), "do-not-store-this"); recorder.flush();
  dom.window.document.querySelector("select").dispatchEvent(new dom.window.Event("change", { bubbles: true })); recorder.stop();
  assert.equal(events.length, 2); assert.ok(events.every(event => event.redacted && !("value" in event)));
  assert.doesNotMatch(JSON.stringify(events), /do-not-store-this|very-secret/); dom.window.close();
});

test("ambiguous semantic targets cannot fall through to a positional guess", () => {
  const dom = page('<button>Save</button><button>Save</button>');
  assert.throws(() => dom.window.FMLDOM.resolve({ description: "Save", locators: [{ kind: "role", role: "button", value: "Save" }, { kind: "css", value: "button:first-child" }] }), /Ambiguous/);
  dom.window.close();
});

test("recording ignores synthetic events by default and all events after stop", () => {
  const dom = page('<label>Name<input name="name"></label>'); const events = [];
  const recorder = new dom.window.FMLRecorder(event => events.push(event)); recorder.start();
  enter(dom.window, dom.window.document.querySelector("input"), "Synthetic"); recorder.flush(); recorder.stop();
  assert.equal(events.length, 0); dom.window.close();
});

test("URL evidence strips credential-like query parameters", () => {
  const dom = page(); const url = dom.window.FMLDOM.safeURL("https://example.test/report?customer=Maya&token=private&code=oauth");
  assert.equal(url, "https://example.test/report?customer=Maya"); dom.window.close();
});

test("Enter plus the browser's implicit submit click records only one submission", () => {
  const dom = page('<form><label>Name<input name="name"></label><button type="submit">Search</button></form>');
  dom.window.document.querySelector("form").onsubmit = event => event.preventDefault();
  const events = []; const recorder = new dom.window.FMLRecorder(event => events.push(event), { trustedOnly: false }); recorder.start();
  const input = dom.window.document.querySelector("input"); enter(dom.window, input, "Maya");
  input.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  dom.window.document.querySelector("button").click(); recorder.stop();
  assert.deepEqual(events.map(event => event.action), ["fill", "press"]);
  dom.window.close();
});

test("stop cancels a waiting assertion", async () => {
  const dom = page(); const execute = attachContent(dom);
  const pending = execute({ type: "EXECUTE", origin: dom.window.location.origin, step: { ...materialize(example.steps.at(-1), resolveInputs(example)), timeoutMs: 2000 } });
  await new Promise(resolve => setTimeout(resolve, 120));
  await execute({ type: "HALT" });
  const result = await pending; assert.equal(result.ok, false); assert.match(result.error, /stopped/); dom.window.close();
});

test("one wrong customer is not success even when the result count is correct", async () => {
  const dom = page(); const execute = attachContent(dom);
  dom.window.document.getElementById("result-count").textContent = "1 customer found";
  dom.window.document.getElementById("customers").innerHTML = "<article><h4>Maya Chen</h4></article>";
  const inputs = resolveInputs(example, { customerName: "Noah" });
  assert.equal((await execute({ type: "EXECUTE", origin: dom.window.location.origin, step: materialize(example.steps[3], inputs) })).ok, true);
  const result = await execute({ type: "EXECUTE", origin: dom.window.location.origin, step: { ...materialize(example.steps[4], inputs), timeoutMs: 150 } });
  assert.equal(result.ok, false); assert.match(result.error, /Success check failed/);
  dom.window.close();
});

test("a completely different site can teach a date input and replay an independent result", async () => {
  const html = '<form><label for="from">Start date</label><input id="from" type="date"><button type="submit">Show schedule</button></form><output id="schedule-date"></output>';
  const url = "https://calendar.example.test/schedule";
  const setup = () => {
    const dom = page(html, url);
    dom.window.document.querySelector("form").onsubmit = event => { event.preventDefault(); dom.window.document.getElementById("schedule-date").textContent = dom.window.document.getElementById("from").value; };
    return dom;
  };
  const first = setup(), events = [];
  const recorder = new first.window.FMLRecorder(event => events.push(event), { trustedOnly: false });
  recorder.start(); enter(first.window, first.window.document.getElementById("from"), "2026-09-03");
  first.window.document.querySelector("button").click();
  recorder.successMode = true; first.window.document.getElementById("schedule-date").click(); recorder.stop();
  const workflow = createTeachingDraft({ schemaVersion: 1, kind: "recording", id: "calendar", name: "View schedule", goal: "Show the requested date", startUrl: url, events });
  acceptInput(workflow, suggestInputs(workflow)[0]);
  assert.deepEqual(validateBrowserRun(workflow), []);
  assert.equal(workflow.inputs.startDate.default, "2026-09-03");
  const second = setup(), execute = attachContent(second);
  const inputs = resolveInputs(workflow, { startDate: "2026-10-15" });
  for (const step of workflow.steps.slice(1)) assert.equal((await execute({ type: "EXECUTE", origin: second.window.location.origin, step: materialize(step, inputs) })).ok, true);
  assert.equal(second.window.document.getElementById("schedule-date").textContent, "2026-10-15");
  first.window.close(); second.window.close();
});

test("native file selections and unsupported editable controls produce gaps without recording their values", () => {
  const dom = page('<input id="attachment" type="file"><div contenteditable="true" id="editor"></div>');
  const events = [], recorder = new dom.window.FMLRecorder(event => events.push(event), { trustedOnly: false });
  recorder.start();
  dom.window.document.getElementById("attachment").dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  dom.window.document.getElementById("editor").dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  recorder.stop();
  assert.deepEqual(events.map(event => event.action), ["unsupported", "unsupported"]);
  assert.ok(events.every(event => !Object.hasOwn(event, "value")));
  dom.window.close();
});
