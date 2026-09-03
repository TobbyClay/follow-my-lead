import test from "node:test";
import assert from "node:assert/strict";
import { clone, draftWorkflow, materialize, resolveInputs, validateBrowserRun } from "../extension/core/workflow.js";
import { acceptInput, compareDemonstrations, createTeachingDraft, explainWorkflow, suggestInputs, successCoverage, transferTestPlan, workflowFingerprint } from "../extension/core/learning.js";
import { example } from "./helpers.mjs";

const origin = "https://inventory.example.test";
const target = (description, selector) => ({ description, locators: [{ kind: "css", value: selector }] });
function recording(term = "Copper", category = "materials") {
  return { schemaVersion: 1, kind: "recording", id: `demo-${term}`, name: "Find inventory", goal: "Find the requested inventory item", startUrl: origin + "/", events: [
    { eventId: "fill", action: "fill", target: target("Search term", "#query"), value: term, url: origin + "/" },
    { eventId: "select", action: "select", target: target("Category", "#category"), value: category, url: origin + "/" },
    { eventId: "click", action: "click", target: target("Search", "#search"), url: origin + "/" },
    { action: "navigate", url: origin + "/results?q=" + term, navigation: { kind: "observed", causeEventId: "click" } },
    { action: "assertText", target: target("Result item", "#result-name"), value: term, match: "equals", url: origin + "/results?q=" + term }
  ] };
}

test("manual navigation is preserved, observed navigation becomes a checkpoint, and ambiguous legacy evidence blocks replay", () => {
  const source = recording();
  const observed = draftWorkflow(source);
  assert.deepEqual(observed.steps.map(step => step.action), ["navigate", "fill", "select", "click", "waitForURL", "assertText"]);
  assert.deepEqual(validateBrowserRun(observed), []);
  source.events[3].navigation = { kind: "explicit" };
  assert.equal(draftWorkflow(source).steps[4].action, "navigate");
  delete source.events[3].navigation;
  assert.match(validateBrowserRun(draftWorkflow(source)).join(" "), /cause was not captured/);
  source.events[3].url = "https://unapproved.test/";
  assert.match(validateBrowserRun(draftWorkflow(source)).join(" "), /left its website/);
});

test("generic suggestions connect accepted inputs to results and changing URL queries", () => {
  const workflow = createTeachingDraft(recording());
  const suggestions = suggestInputs(workflow);
  assert.deepEqual(suggestions.map(item => item.key), ["searchTerm", "category"]);
  assert.deepEqual(workflow.inputs, {}, "a suggestion is not silently accepted");
  acceptInput(workflow, suggestions[0], "itemName", "Inventory item");
  assert.equal(workflow.inputs.itemName.default, "Copper");
  assert.deepEqual(workflow.steps.at(-1).value, { input: "itemName" });
  const inputs = resolveInputs(workflow, { itemName: "Steel & Brass" });
  assert.equal(materialize(workflow.steps[4], inputs).url, origin + "/results?q=Steel+%26+Brass");
  assert.deepEqual(validateBrowserRun(workflow), []);
  assert.deepEqual(successCoverage(workflow).covered, ["itemName"]);
  assert.deepEqual(transferTestPlan(workflow, inputs).errors, []);
  assert.equal(workflow.learning.reviewed, false);
});

test("labels, dates, languages, and colliding names remain website-independent", () => {
  const source = recording();
  source.events = [
    { action: "fill", target: target("Start date", "#from"), value: "2026-09-03", url: origin + "/" },
    { action: "fill", target: target("Start date", "#other-date"), value: "2026-10-01", url: origin + "/" },
    { action: "fill", target: target("Nome do cliente", "#name"), value: "Amara", url: origin + "/" },
    { action: "fill", target: target("検索語", "#japanese"), value: "本", url: origin + "/" },
    { action: "fill", target: target("API token", "#token"), value: "not-a-suggestion", url: origin + "/" }
  ];
  const suggestions = suggestInputs(draftWorkflow(source));
  assert.deepEqual(suggestions.map(item => item.key), ["startDate", "startDate2", "nomeDoCliente", "input5"]);
  assert.equal(suggestions[3].label, "検索語");
});

test("two demonstrations distinguish changing inputs from fixed choices without inventing branches", () => {
  const first = recording("Copper"), second = recording("Steel");
  const workflow = createTeachingDraft(first, second);
  const suggestions = suggestInputs(workflow);
  assert.equal(suggestions[0].confidence, "observed variation");
  assert.equal(suggestions[1].confidence, "likely fixed");
  const other = draftWorkflow(second); other.steps.splice(2, 1);
  assert.equal(compareDemonstrations(draftWorkflow(first), other).compatible, false);
  assert.equal(createTeachingDraft(first, { ...second, events: second.events.slice(1) }).learning.unresolved.length > 0, true);
});

test("unrelated input changes, count-only checks, and checking the entered field cannot verify transfer", () => {
  const workflow = clone(example);
  workflow.inputs.unused = { type: "string", default: "one" };
  assert.match(transferTestPlan(workflow, { customerName: "Maya", unused: "two" }).errors.join(" "), /Change at least one/);
  workflow.steps.pop();
  assert.match(transferTestPlan(workflow, { customerName: "Noah" }).errors.join(" "), /independent result check/);
  workflow.steps.push({ id: "self-check", action: "assertValue", context: "main", target: workflow.steps[1].target, value: { input: "customerName" } });
  assert.match(transferTestPlan(workflow, { customerName: "Noah" }).errors.join(" "), /entered field itself/);
});

test("teach-back includes actual steps, expected input, assumptions, and unresolved gaps", () => {
  const workflow = clone(example);
  workflow.learning.unresolved = ["Missing alternate path"];
  const explanation = explainWorkflow(workflow);
  assert.equal(explanation.steps.length, 5);
  assert.ok(explanation.expected.some(text => text.includes("[Customer name]")));
  assert.ok(explanation.warnings.includes("Missing alternate path"));
  assert.equal(explanation.assumptions.length, 1);
});

test("verification fingerprints follow execution changes and ignore imported verification claims", async () => {
  const original = await workflowFingerprint(example);
  assert.equal(await workflowFingerprint({ ...example, verification: { status: "verified" } }), original);
  const edited = clone(example); edited.steps.at(-1).match = "equals";
  assert.notEqual(await workflowFingerprint(edited), original);
  edited.steps.at(-1).match = "contains"; edited.revision++;
  assert.notEqual(await workflowFingerprint(edited), original);
});

test("unsupported evidence remains an explicit learning gap", () => {
  const source = recording(); source.events.splice(1, 0, { action: "unsupported", reason: "File selection is unsupported", url: origin + "/" });
  assert.match(validateBrowserRun(draftWorkflow(source)).join(" "), /File selection/);
});
