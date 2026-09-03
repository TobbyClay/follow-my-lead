import { clone, safeKey, teachingPrompt, validateBrowserRun } from "../core/workflow.js";
import { acceptInput, bindAssertion, explainWorkflow, inputSuggestionDetails, suggestInputs } from "../core/learning.js";

const $ = id => document.getElementById(id);
let state = { recordings: [], workflows: [], tabs: [] }, draft = null, signatures = {}, busy = false;
const call = async message => { const result = await chrome.runtime.sendMessage(message); if (!result?.ok) throw new Error(result?.error || "The extension did not respond."); return result; };
function notice(text, error = false) { $("notice").hidden = false; $("notice").textContent = text; $("notice").classList.toggle("error", error); }
function bind(id, handler) {
  $(id).addEventListener("click", async () => {
    if (busy) return;
    busy = true; $(id).disabled = true;
    try { await handler(); } catch (error) { notice(error.message, true); }
    finally { busy = false; $(id).disabled = false; await refresh().catch(() => {}); }
  });
}
function element(tag, text, className) { const item = document.createElement(tag); if (text !== undefined) item.textContent = text; if (className) item.className = className; return item; }
function options(id, rows, empty) {
  const signature = JSON.stringify(rows);
  if (signatures[id] === signature) return false;
  signatures[id] = signature;
  const select = $(id), previous = select.value;
  select.replaceChildren(...(rows.length ? rows : [{ id: "", text: empty }]).map(row => { const option = element("option", row.text); option.value = row.id; return option; }));
  if (rows.some(row => String(row.id) === previous)) select.value = previous;
  return true;
}
const selectedRecording = () => state.recordings.find(item => item.id === $("recordings").value);
const selectedWorkflow = () => state.workflows.find(item => item.id === $("workflows").value);
const selectedComparison = () => state.recordings.find(item => item.id === $("comparison").value);
function changedDraft() { draft.learning = { ...draft.learning, reviewed: false }; $("reviewed").checked = false; }
function download(filename, value) {
  const url = URL.createObjectURL(new Blob([typeof value === "string" ? value : JSON.stringify(value, null, 2)], { type: "application/json" }));
  const anchor = element("a"); anchor.href = url; anchor.download = filename; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
async function grant(origin) {
  const url = new URL(origin);
  const allowed = await chrome.permissions.request({ origins: [`${url.protocol}//${url.hostname}/*`] });
  if (!allowed) throw new Error("Website access was not granted.");
}
async function refresh() {
  state = await call({ type: "GET" });
  const active = state.recordings.find(item => item.status === "recording");
  $("record-status").textContent = active ? `● ${active.events.length} events` : "Ready";
  $("start").disabled = !!active || state.run?.status === "running";
  $("mark-success").disabled = !active; $("stop").disabled = !active;
  $("stop-run").disabled = state.run?.status !== "running";
  $("run").disabled = !!active || state.run?.status === "running" || !state.workflows.length;
  $("test-run").disabled = $("run").disabled;
  const tabs = [...state.tabs].sort((a, b) => Number(b.active) - Number(a.active));
  options("target-tab", tabs.map(tab => ({ id: tab.id, text: `${tab.title || "Website"} · ${new URL(tab.url).hostname}` })), "Open this popup on a website tab");
  options("recordings", state.recordings.map(item => ({ id: item.id, text: `${item.name} · ${item.events.length} events${item.status === "recording" ? " · recording" : ""}` })), "No demonstrations yet");
  renderComparisons();
  if (options("workflows", state.workflows.map(item => ({ id: item.id, text: `${item.name} · v${item.revision}` })), "Save a task first")) renderInputs();
  $("live-events").replaceChildren(...(active?.events.slice(-4) || []).map(event => element("div", `${event.redacted ? "Excluded sensitive field" : event.action} · ${event.target?.description || "Page navigation"}`)));
  const run = state.run;
  $("run-result").textContent = run ? `${run.status === "succeeded" ? run.taskVerified ? "✓ Different-input test passed · revision verified" : "✓ Run passed its checks · not a new transfer test" : run.status.toUpperCase()} · ${run.log.length} completed steps\n${run.error || ""}${run.log.slice(-6).map(entry => `\n${entry.result?.verified ? "✓" : "→"} ${entry.stepId}: ${entry.action}`).join("")}` : "Run evidence will appear here. No task is verified yet.";
  renderVerification();
}
function renderComparisons() {
  options("comparison", [{ id: "", text: "No comparison" }, ...state.recordings.filter(item => item.status !== "recording" && item.id !== $("recordings").value).map(item => ({ id: item.id, text: `${item.name} · ${item.events.length} events` }))], "No comparison");
}
function renderVerification() {
  const workflow = selectedWorkflow(), proof = state.verifications?.[workflow?.id];
  const verified = !!workflow && proof?.status === "verified" && proof.workflowRevision === workflow.revision;
  $("verification-status").textContent = verified ? `Verified · v${workflow.revision}` : "Not verified";
  $("verification-status").classList.toggle("verified", verified);
  $("test-guidance").textContent = verified ? `Passed a different-input test for: ${proof.changedInputs.join(", ")}. This proves the tested case only; editing the task requires a new test.` : "Change an input from the demonstration, then choose Test with different input. The test must check the requested result, not just the entered field. Saving or importing a task does not verify it.";
}
function renderTeachBack() {
  const explanation = explainWorkflow(draft), panel = $("teach-back");
  panel.replaceChildren(element("p", explanation.method, "subtle"), element("p", explanation.summary));
  for (const [title, items] of [["Steps", explanation.steps], ["Changing inputs", explanation.inputs], ["Assumptions", explanation.assumptions], ["Decision rules", explanation.decisionRules], ["Expected result", explanation.expected], ["Limits & gaps", explanation.warnings]]) {
    panel.append(element("h4", title));
    if (!items.length) panel.append(element("p", title === "Changing inputs" ? "No reusable inputs accepted yet." : "None specified."));
    else { const list = element(title === "Steps" ? "ol" : "ul"); list.append(...items.map(item => element("li", item))); panel.append(list); }
  }
}
function renderSuggestions() {
  const suggestions = suggestInputs(draft).filter(item => !item.stepIds.every(id => draft.learning?.fixedStepIds?.includes(id)));
  $("input-suggestions").replaceChildren(...suggestions.map(proposed => {
    const item = inputSuggestionDetails(draft, proposed), row = element("div", undefined, "suggestion");
    row.append(element("strong", item.label), element("p", `${item.confidence}: ${item.reason}`, "hint"));
    const label = element("input"); label.value = item.label; label.setAttribute("aria-label", `Label for ${item.key}`);
    const key = element("input"); key.value = item.key; key.setAttribute("aria-label", `Input key for ${item.key}`);
    row.append(element("label", "Label"), label, element("label", "Input key"), key);
    const link = element("input"); link.type = "checkbox"; link.checked = item.assertionIds.length > 0;
    if (item.assertionIds.length) { const caption = element("label", undefined, "check-row"); caption.append(link, document.createTextNode(`Also link ${item.assertionIds.length} matching result check(s) to this input`)); row.append(caption); }
    else row.append(element("p", "No matching result marker yet. Link a result check below before testing a different input.", "hint"));
    const actions = element("div", undefined, "actions"), accept = element("button", "Accept input"), fixed = element("button", "Keep fixed");
    accept.onclick = () => { try { acceptInput(draft, item, key.value, label.value, link.checked); renderDraft(); } catch (error) { notice(error.message, true); } };
    fixed.onclick = () => { draft.learning.fixedStepIds = [...(draft.learning.fixedStepIds || []), ...item.stepIds]; changedDraft(); renderDraft(); };
    actions.append(accept, fixed); row.append(actions); return row;
  }));
  if (!suggestions.length) $("input-suggestions").append(element("p", "All observed values are accepted inputs or kept fixed.", "hint"));
  const comparison = draft.learning?.comparison;
  $("comparison-result").textContent = comparison ? comparison.compatible ? `Two demonstrations compared: ${comparison.changed.length} changing field(s), ${comparison.fixed.length} fixed field(s). ${comparison.reason}` : comparison.reason : "One demonstration: suggestions are hypotheses until reviewed and tested.";
}
function checkDraft() {
  if (!draft) return;
  draft.name = $("workflow-name").value; draft.goal = $("workflow-goal").value;
  draft.learning = { ...draft.learning, reviewed: $("reviewed").checked };
  const errors = validateBrowserRun(draft);
  if (draft.learning.unresolved?.length) errors.push(...draft.learning.unresolved);
  $("validation").textContent = errors.length ? errors.join("\n") : "✓ Structure is valid. Browser execution and different-input verification are separate checks.";
  $("validation").classList.toggle("ok", !errors.length);
  $("json-editor").value = JSON.stringify(draft, null, 2);
  void chrome.storage.session.set({ editorDraft: draft });
  renderTeachBack();
}
function renderDraft() {
  $("editor").hidden = !draft; if (!draft) return;
  $("workflow-name").value = draft.name; $("workflow-goal").value = draft.goal;
  $("reviewed").checked = draft.learning?.reviewed === true;
  $("learning-method").textContent = draft.learning?.method === "local-draft" ? "Local draft · AI not used" : "Imported workflow";
  $("steps").replaceChildren(...draft.steps.map((step, index) => {
    const row = element("li", undefined, "step");
    const heading = element("div", undefined, "step-heading"); heading.append(element("span", String(index + 1).padStart(2, "0"), "index"), element("span", step.action));
    const remove = element("button", "Remove", "remove"); remove.onclick = () => { draft.steps.splice(index, 1); changedDraft(); renderDraft(); }; heading.append(remove);
    row.append(heading, element("p", step.target?.description || step.url));
    if (["navigate", "waitForURL"].includes(step.action)) {
      const url = element("input"); url.value = step.url; url.setAttribute("aria-label", `Step ${index + 1} URL`); url.onchange = () => { step.url = url.value; changedDraft(); checkDraft(); }; row.append(url);
      if (step.queryInputs) row.append(element("p", `Query inputs: ${Object.entries(step.queryInputs).map(([parameter, input]) => `${parameter} ← ${input}`).join(", ")}`));
    }
    if (step.value !== undefined) {
      const reference = step.value && typeof step.value === "object";
      const valueLabel = element("label", step.action.startsWith("assert") ? "Expected result" : "Demonstrated value");
      const value = element("input"); value.type = step.action === "check" ? "checkbox" : "text";
      const current = reference ? draft.inputs[step.value.input]?.default : step.value;
      if (value.type === "checkbox") value.checked = !!current; else value.value = current ?? "";
      value.setAttribute("aria-label", `Step ${index + 1} value`);
      value.onchange = () => { const updated = value.type === "checkbox" ? value.checked : value.value; if (step.value && typeof step.value === "object") draft.inputs[step.value.input].default = updated; else step.value = updated; changedDraft(); checkDraft(); renderSuggestions(); };
      row.append(valueLabel, value);
      if (step.action.startsWith("assert")) {
        const binding = element("select"); binding.setAttribute("aria-label", `Step ${index + 1} expected input`);
        const fixed = element("option", "Fixed expected result"); fixed.value = ""; binding.append(fixed);
        for (const [name, input] of Object.entries(draft.inputs).filter(([, input]) => input.type === "string")) { const option = element("option", `Requested ${input.description || name}`); option.value = name; binding.append(option); }
        binding.value = reference ? step.value.input : "";
        binding.onchange = () => { try { if (binding.value) bindAssertion(draft, step.id, binding.value); else step.value = current; changedDraft(); renderDraft(); } catch (error) { notice(error.message, true); } };
        row.append(element("label", "Check against"), binding);
        if (step.action === "assertText") {
          const match = element("select"); match.setAttribute("aria-label", `Step ${index + 1} text match`);
          for (const mode of ["contains", "equals"]) { const option = element("option", mode); option.value = mode; match.append(option); }
          match.value = step.match || "contains"; match.onchange = () => { step.match = match.value; changedDraft(); checkDraft(); }; row.append(match);
        }
        return row;
      }
      const variableLabel = element("label", undefined, "check-row");
      const variable = element("input"); variable.type = "checkbox"; variable.checked = !!reference;
      variableLabel.append(variable, document.createTextNode("Change this value on each run")); row.append(variableLabel);
      const key = element("input"); key.placeholder = "Input name, e.g. customerName"; key.value = reference ? step.value.input : `input${index + 1}`; key.hidden = !reference;
      key.setAttribute("aria-label", `Step ${index + 1} input name`); row.append(key);
      variable.onchange = () => {
        if (variable.checked) {
          if (!safeKey(key.value)) { variable.checked = false; notice("Use a simple input name starting with a letter.", true); return; }
          const literal = step.value; draft.inputs[key.value] ??= { type: typeof literal, default: literal, required: true };
          draft.learning.demonstrationInputs ??= {}; draft.learning.demonstrationInputs[key.value] ??= literal;
          step.value = { input: key.value };
        } else {
          const oldKey = step.value.input; step.value = draft.inputs[oldKey].default;
          if (!draft.steps.some(item => item.value?.input === oldKey || Object.values(item.queryInputs || {}).includes(oldKey))) delete draft.inputs[oldKey];
        }
        changedDraft();
        renderDraft();
      };
      key.onchange = () => {
        if (!safeKey(key.value)) { notice("Input names must start with a letter and contain letters, digits, underscores, or hyphens.", true); return; }
        const previous = step.value.input;
        draft.inputs[key.value] ??= clone(draft.inputs[previous]); step.value.input = key.value;
        draft.learning.demonstrationInputs ??= {}; draft.learning.demonstrationInputs[key.value] ??= draft.learning.demonstrationInputs[previous] ?? draft.inputs[key.value].default;
        if (!draft.steps.some(item => item.value?.input === previous || Object.values(item.queryInputs || {}).includes(previous))) delete draft.inputs[previous];
        changedDraft();
        renderDraft();
      };
    }
    return row;
  }));
  renderSuggestions();
  checkDraft();
}
function renderInputs() {
  const workflow = selectedWorkflow();
  $("run-inputs").replaceChildren(...Object.entries(workflow?.inputs || {}).map(([name, input]) => {
    const group = element("div"); const label = element("label", input.description || name); label.htmlFor = `input-${name}`;
    const control = element("input"); control.id = `input-${name}`; control.dataset.input = name; control.type = input.type === "boolean" ? "checkbox" : "text";
    if (control.type === "checkbox") control.checked = input.default || false; else control.value = input.default || "";
    group.append(label, control); return group;
  }));
  renderVerification();
}
bind("open", () => call({ type: "OPEN" }));
bind("start", async () => {
  const tab = state.tabs.find(tab => String(tab.id) === $("target-tab").value);
  if (!tab) throw new Error("Open Follow My Lead from the extension button on the website you want to teach.");
  await grant(new URL(tab.url).origin);
  await call({ type: "START", tabId: tab.id, name: $("task-name").value, goal: $("goal").value });
  notice("Recording started. Return to your website and perform the task.");
});
bind("stop", async () => { await call({ type: "STOP" }); notice("Demonstration saved locally. Create a draft or export it for AI learning."); });
bind("mark-success", async () => { await call({ type: "MARK_SUCCESS" }); window.close(); });
bind("draft", async () => { const item = selectedRecording(); if (!item) throw new Error("Record a task first."); draft = (await call({ type: "DRAFT", id: item.id, comparisonId: $("comparison").value })).workflow; renderDraft(); });
bind("export-recording", () => { const item = selectedRecording(); if (!item) throw new Error("Choose a recording."); if (item.status === "recording") throw new Error("Stop recording first."); const exported = clone(item); delete exported.tabId; download(`follow-my-lead-${item.id}.recording.json`, exported); });
bind("copy-prompt", async () => { const item = selectedRecording(); if (!item) throw new Error("Choose a recording."); await navigator.clipboard.writeText(teachingPrompt(item, selectedComparison())); notice("Teaching prompt copied. Paste it in this Codex project and attach the recording, plus the second demonstration if selected."); });
$("import-workflow").onchange = async event => {
  try { const file = event.target.files[0]; if (!file) return; if (file.size > 2_000_000) throw new Error("Choose a workflow smaller than 2 MB."); const parsed = JSON.parse(await file.text()); const errors = validateBrowserRun(parsed); if (errors.length) throw new Error(errors.join(" ")); draft = parsed; draft.learning = { ...draft.learning, reviewed: false }; renderDraft(); }
  catch (error) { notice(error.message, true); } finally { event.target.value = ""; }
};
for (const id of ["workflow-name", "workflow-goal"]) $(id).onchange = () => { changedDraft(); checkDraft(); };
$("reviewed").onchange = checkDraft;
$("recordings").onchange = renderComparisons;
bind("save", async () => { if (!draft) throw new Error("Create or import a workflow first."); checkDraft(); if (!draft.learning.reviewed) throw new Error("Review the workflow and check the review box."); const result = await call({ type: "SAVE_WORKFLOW", workflow: draft }); draft = result.workflow; renderDraft(); notice("Task saved. Enter its next inputs below and run it."); });
bind("export-workflow", () => { checkDraft(); const errors = validateBrowserRun(draft); if (errors.length) throw new Error(errors.join(" ")); download(`${draft.id}.workflow.json`, draft); });
bind("apply-json", () => { const parsed = JSON.parse($("json-editor").value); const errors = validateBrowserRun(parsed); if (errors.length) throw new Error(errors.join(" ")); draft = parsed; draft.learning = { ...draft.learning, reviewed: false }; renderDraft(); });
$("workflows").onchange = renderInputs;
bind("edit-saved", () => { const item = selectedWorkflow(); if (!item) throw new Error("Choose a saved task."); draft = clone(item); renderDraft(); });
async function startRun(mode) {
  const workflow = selectedWorkflow(); if (!workflow) throw new Error("Save a reviewed task first.");
  await grant(Object.values(workflow.contexts)[0].origin);
  const inputs = {}; for (const control of $("run-inputs").querySelectorAll("input")) inputs[control.dataset.input] = control.type === "checkbox" ? control.checked : control.value;
  await call({ type: "RUN", workflow, inputs, mode }); notice(mode === "test" ? "Testing a different input in a new tab. This revision is verified only if its result checks pass." : "Running in a new tab. Keep Chrome open to check the result.");
}
bind("run", () => startRun("run"));
bind("test-run", () => startRun("test"));
bind("stop-run", () => call({ type: "STOP" }));
try { await refresh(); const session = await chrome.storage.session.get("editorDraft"); if (session.editorDraft) { draft = session.editorDraft; renderDraft(); } }
catch (error) { notice(error.message, true); }
setInterval(() => { if (!busy) void refresh().catch(error => notice(error.message, true)); }, 1500);
