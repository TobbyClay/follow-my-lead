import { draftWorkflow, httpURL, own, safeKey } from "./workflow.js";

const edits = new Set(["fill", "select", "check"]);
const assertions = new Set(["assertText", "assertValue"]);
const sensitive = /password|passcode|secret|token|api.?key|credit.?card|cvv|cvc|one.?time|\botp\b/i;
const literal = value => typeof value === "string" || typeof value === "boolean";
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function sameTarget(a, b) {
  if (!a || !b) return false;
  return (a.locators || []).some(left => (b.locators || []).some(right => same(left, right)));
}

function inputName(label, fallback) {
  const words = String(label).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").match(/[a-zA-Z0-9]+/g) || [];
  const name = words.map((word, index) => index ? word[0].toUpperCase() + word.slice(1) : word[0].toLowerCase() + word.slice(1)).join("").slice(0, 64);
  return safeKey(name) ? name : fallback;
}

export function compareDemonstrations(first, second) {
  if (first.contexts.main.origin !== second.contexts.main.origin || first.steps.length !== second.steps.length) return { compatible: false, reason: "The demonstrations use different sites or paths. Review them with AI; no branching rule was inferred." };
  const changed = [], fixed = [];
  for (let index = 0; index < first.steps.length; index++) {
    const a = first.steps[index], b = second.steps[index];
    const navigation = ["navigate", "waitForURL"].includes(a.action);
    const samePage = navigation && httpURL(a.url)?.origin === httpURL(b.url)?.origin && httpURL(a.url)?.pathname === httpURL(b.url)?.pathname;
    if (a.action !== b.action || a.context !== b.context || (navigation ? !samePage : !sameTarget(a.target, b.target))) return { compatible: false, reason: `The demonstrations differ at step ${index + 1}. Review the paths; no branching rule was inferred.` };
    if (edits.has(a.action)) (same(a.value, b.value) ? fixed : changed).push({ stepId: a.id, first: a.value, second: b.value });
  }
  return { compatible: true, changed, fixed, reason: "Matching observed paths only. Two examples do not establish unseen branches." };
}

export function suggestInputs(workflow) {
  const used = new Set(Object.keys(workflow.inputs || {}));
  const suggestions = [];
  for (const [index, step] of workflow.steps.entries()) {
    if (!edits.has(step.action) || !literal(step.value)) continue;
    if (typeof step.value === "string" && !step.value.trim()) continue;
    const label = step.target?.description || `Input ${index + 1}`;
    if (sensitive.test([label, step.target?.name, step.target?.inputType].join(" "))) continue;
    const previous = suggestions.find(item => item.context === step.context && sameTarget(item.target, step.target) && same(item.value, step.value));
    if (previous) { previous.stepIds.push(step.id); continue; }
    const base = inputName(label, `input${index + 1}`);
    let key = base, suffix = 2;
    while (used.has(key)) key = `${base.slice(0, 59)}${suffix++}`;
    used.add(key);
    const comparison = workflow.learning?.comparison;
    const varied = comparison?.compatible && comparison.changed.some(item => item.stepId === step.id);
    const fixed = comparison?.compatible && comparison.fixed.some(item => item.stepId === step.id);
    const reason = varied ? "Changed between both demonstrations." : fixed ? "Stayed the same in both demonstrations; likely a fixed setting." : `${step.action === "fill" ? "Entered" : "Selected"} in a named control. Confirm whether it changes between runs.`;
    suggestions.push({ key, label, type: typeof step.value, value: step.value, context: step.context, target: step.target, stepIds: [step.id], reason, confidence: varied ? "observed variation" : fixed ? "likely fixed" : "suggestion" });
  }
  return suggestions;
}

function matchingAssertions(workflow, suggestion) {
  return workflow.steps.filter(step => {
    if (!assertions.has(step.action) || step.context !== suggestion.context || typeof step.value !== "string" || typeof suggestion.value !== "string" || sameTarget(step.target, suggestion.target)) return false;
    if (step.value === suggestion.value) return true;
    return step.action === "assertText" && step.match !== "equals" && suggestion.value.length >= 2 && step.value.includes(suggestion.value);
  });
}

export function inputSuggestionDetails(workflow, suggestion) {
  return { ...suggestion, assertionIds: matchingAssertions(workflow, suggestion).map(step => step.id) };
}

export function bindAssertion(workflow, stepId, input) {
  const step = workflow.steps.find(item => item.id === stepId);
  if (!step || !assertions.has(step.action) || !own(workflow.inputs, input) || workflow.inputs[input].type !== "string") throw new Error("Choose a string input and a result assertion.");
  const old = typeof step.value === "string" ? step.value : workflow.inputs[step.value?.input]?.default;
  const example = workflow.inputs[input].default;
  // Example-specific text/accessible names cannot locate the result on a changed-input run.
  step.target.locators = step.target.locators.filter(locator => !["text", "role"].includes(locator.kind) || ![old, example].some(value => typeof value === "string" && value && locator.value.includes(value)));
  step.value = { input };
  workflow.learning.reviewed = false;
}

export function acceptInput(workflow, proposed, key = proposed.key, label = proposed.label, linkResults = true) {
  if (!safeKey(key)) throw new Error("Use an input name starting with a letter, with letters, digits, underscores or hyphens.");
  if (own(workflow.inputs, key)) throw new Error("That input name already exists. Choose a distinct name or use the step editor to link an existing input.");
  const current = suggestInputs(workflow).find(item => same(item.stepIds, proposed.stepIds));
  if (!current) throw new Error("This suggestion is out of date. Review the current draft.");
  const linked = linkResults ? matchingAssertions(workflow, current) : [];
  workflow.inputs[key] = { type: current.type, description: label.trim() || current.label, default: current.value, required: true };
  workflow.learning.demonstrationInputs ??= {};
  workflow.learning.demonstrationInputs[key] = current.value;
  for (const step of workflow.steps) {
    if (current.stepIds.includes(step.id)) step.value = { input: key };
    if (step.url && current.type === "string") {
      const url = httpURL(step.url);
      for (const [parameter, value] of url?.searchParams || []) if (value === current.value && url.searchParams.getAll(parameter).length === 1) {
        step.queryInputs ??= {}; step.queryInputs[parameter] = key;
      }
    }
  }
  for (const step of linked) bindAssertion(workflow, step.id, key);
  workflow.learning.reviewed = false;
  return workflow;
}

export function successCoverage(workflow) {
  const used = Object.keys(workflow.inputs || {}).filter(key => workflow.steps.some(step => edits.has(step.action) && step.value?.input === key || Object.values(step.queryInputs || {}).includes(key)));
  const covered = used.filter(key => workflow.steps.some(step => assertions.has(step.action) && step.value?.input === key && !workflow.steps.some(edit => edits.has(edit.action) && edit.value?.input === key && edit.context === step.context && sameTarget(edit.target, step.target))));
  return { used, covered, missing: used.filter(key => !covered.includes(key)) };
}

export function transferTestPlan(workflow, inputs) {
  const coverage = successCoverage(workflow);
  const demonstrated = workflow.learning?.demonstrationInputs || {};
  const changed = coverage.used.filter(key => inputs[key] !== (own(demonstrated, key) ? demonstrated[key] : workflow.inputs[key].default));
  const errors = [];
  if (!changed.length) errors.push("Change at least one task input from its demonstrated value before testing.");
  const unchecked = changed.filter(key => !coverage.covered.includes(key));
  if (unchecked.length) errors.push(`Link an independent result check to each changed input: ${unchecked.join(", ")}. Checking the entered field itself does not prove the result.`);
  return { changed, errors };
}

const displayValue = (value, workflow) => value && typeof value === "object" ? `[${workflow.inputs[value.input]?.description || value.input}]` : JSON.stringify(value);
function describeStep(step, workflow) {
  const value = displayValue(step.value, workflow), target = step.target?.description || "the target";
  if (step.action === "navigate") return `Open ${step.url}${step.queryInputs ? " using the supplied query inputs" : ""}.`;
  if (step.action === "waitForURL") return `Wait for ${step.url}${step.queryInputs ? " using the supplied query inputs" : ""}; do not open it again.`;
  if (step.action === "fill") return `Enter ${value} in ${target}.`;
  if (step.action === "select") return `Select ${value} in ${target}.`;
  if (step.action === "check") return `Set ${target} to ${value}.`;
  if (step.action === "click") return `Click ${target}.`;
  if (step.action === "press") return `Press ${step.key} in ${target}.`;
  return `Check ${target} ${step.action === "assertValue" || step.match === "equals" ? "equals" : "contains"} ${value}.`;
}
export function explainWorkflow(workflow) {
  const coverage = successCoverage(workflow);
  return {
    method: workflow.learning?.method === "codex-skill" ? "AI-authored explanation (review required)" : "Local teach-back · no AI used",
    summary: typeof workflow.learning?.summary === "string" ? workflow.learning.summary : workflow.goal,
    steps: workflow.steps.map(step => describeStep(step, workflow)),
    inputs: Object.entries(workflow.inputs || {}).map(([key, input]) => `${input.description || key} (${key}); demonstrated ${displayValue(workflow.learning?.demonstrationInputs?.[key] ?? input.default, workflow)}.`),
    assumptions: workflow.learning?.assumptions || [], decisionRules: workflow.learning?.decisionRules || [],
    expected: workflow.steps.filter(step => assertions.has(step.action)).map(step => `${step.target?.description}: ${step.action === "assertValue" || step.match === "equals" ? "equals" : "contains"} ${displayValue(step.value, workflow)}.`),
    warnings: [...(workflow.learning?.unresolved || []), ...coverage.missing.map(key => `No independent input-linked outcome check for ${key}. A different-input test cannot verify this input yet.`), "A successful test covers the tested input and path, not every possible website state."],
  };
}

export function createTeachingDraft(recording, comparison) {
  const workflow = draftWorkflow(recording);
  if (comparison) {
    const second = draftWorkflow(comparison);
    workflow.learning.comparison = { sourceRecording: comparison.id, ...compareDemonstrations(workflow, second) };
    workflow.learning.unresolved.push(...second.learning.unresolved.map(gap => `Second demonstration: ${gap}`));
    if (!workflow.learning.comparison.compatible) workflow.learning.unresolved.push(workflow.learning.comparison.reason);
  }
  return workflow;
}

// Stable, local content fingerprint. Imported claims of verification are deliberately excluded.
export async function workflowFingerprint(workflow) {
  const sorted = value => Array.isArray(value) ? value.map(sorted) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sorted(value[key])])) : value;
  const definition = { id: workflow.id, revision: workflow.revision, goal: workflow.goal, contexts: workflow.contexts, inputs: workflow.inputs, steps: workflow.steps, learning: workflow.learning };
  const bytes = new TextEncoder().encode(JSON.stringify(sorted(definition)));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
