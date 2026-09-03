import test from "node:test";
import assert from "node:assert/strict";
import { clone, draftWorkflow, materialize, resolveInputs, validateBrowserRun, validateWorkflow } from "../extension/core/workflow.js";
import { example } from "./helpers.mjs";

test("a reusable example resolves a new input without changing its saved definition", () => {
  assert.deepEqual(validateBrowserRun(example), []);
  const inputs = resolveInputs(example, { customerName: "Noah" });
  assert.equal(materialize(example.steps[1], inputs).value, "Noah");
  assert.deepEqual(example.steps[1].value, { input: "customerName" });
  assert.throws(() => resolveInputs(example, { customerName: "" }), /Provide a value/);
  assert.throws(() => resolveInputs(example, { customerName: false }), /string/);
});
test("invalid workflows fail before any browser action", () => {
  const cases = [
    [workflow => workflow.steps.splice(-2), /success assertion/],
    [workflow => workflow.steps[0].url = "javascript:alert(1)", /navigation/],
    [workflow => workflow.steps[0].url = "https://elsewhere.test/", /origin/],
    [workflow => workflow.steps[1].value = { input: "missing" }, /Unknown input/],
    [workflow => workflow.steps[1].id = workflow.steps[0].id, /unique id/],
    [workflow => workflow.steps.at(-1).value = "", /nonempty/],
    [workflow => workflow.learning.unresolved = ["Missing branch"], /learning gaps/],
    [workflow => workflow.inputs.customerName.default = 14, /Default type/],
    [workflow => workflow.schemaVersion = 99, /version 1/]
  ];
  for (const [mutate, expected] of cases) { const workflow = clone(example); mutate(workflow); assert.match(validateBrowserRun(workflow).join(" "), expected); }
});
test("a desktop context is representable but rejected by the browser installation", () => {
  const workflow = clone(example);
  workflow.contexts.desktop = { adapter: "windows", application: "notepad.exe" };
  workflow.steps[1].context = "desktop";
  assert.deepEqual(validateWorkflow(workflow), []);
  assert.match(validateBrowserRun(workflow).join(" "), /desktop adapter is not installed/);
});
test("a redacted operation is an unresolved learning gap, not silently considered complete", () => {
  const recording = { schemaVersion: 1, kind: "recording", id: "example", name: "Task", goal: "Search", startUrl: "http://127.0.0.1:8765/", events: [
    { action: "fill", redacted: true, url: "http://127.0.0.1:8765/" }
  ] };
  const draft = draftWorkflow(recording);
  assert.equal(draft.steps.length, 1);
  assert.equal(draft.learning.reviewed, false);
  assert.match(validateBrowserRun(draft).join(" "), /learning gaps/);
});
test("prototype-like keys cannot become input identifiers", () => {
  const workflow = clone(example);
  workflow.inputs = JSON.parse('{"__proto__":{"type":"string","default":"bad"}}');
  assert.match(validateBrowserRun(workflow).join(" "), /Invalid input/);
});

test("malformed learning metadata is rejected as validation errors", () => {
  for (const learning of [{ unresolved: "a string" }, { comparison: { compatible: true, reason: "test", changed: "wrong", fixed: [] } }, { assumptions: [null] }, { demonstrationInputs: { customerName: false } }]) {
    const workflow = clone(example); workflow.learning = learning;
    assert.ok(validateBrowserRun(workflow).length > 0);
  }
});
