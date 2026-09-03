import { clone, safeKey, teachingPrompt, validateBrowserRun } from "../core/workflow.js";

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
  const tabs = [...state.tabs].sort((a, b) => Number(b.active) - Number(a.active));
  options("target-tab", tabs.map(tab => ({ id: tab.id, text: `${tab.title || "Website"} · ${new URL(tab.url).hostname}` })), "Open this popup on a website tab");
  options("recordings", state.recordings.map(item => ({ id: item.id, text: `${item.name} · ${item.events.length} events${item.status === "recording" ? " · recording" : ""}` })), "No demonstrations yet");
  if (options("workflows", state.workflows.map(item => ({ id: item.id, text: `${item.name} · v${item.revision}` })), "Save a task first")) renderInputs();
  $("live-events").replaceChildren(...(active?.events.slice(-4) || []).map(event => element("div", `${event.redacted ? "Excluded sensitive field" : event.action} · ${event.target?.description || "Page navigation"}`)));
  const run = state.run;
  $("run-result").textContent = run ? `${run.status === "succeeded" ? "✓ Success verified" : run.status.toUpperCase()} · ${run.log.length} completed steps\n${run.error || ""}${run.log.slice(-6).map(entry => `\n${entry.result?.verified ? "✓" : "→"} ${entry.stepId}: ${entry.action}`).join("")}` : "Your verified run results will appear here.";
}
function checkDraft() {
  if (!draft) return;
  draft.name = $("workflow-name").value; draft.goal = $("workflow-goal").value;
  draft.learning = { ...draft.learning, reviewed: $("reviewed").checked };
  const errors = validateBrowserRun(draft);
  if (draft.learning.unresolved?.length) errors.push(...draft.learning.unresolved);
  $("validation").textContent = errors.length ? errors.join("\n") : "✓ Structure and final success check are valid.";
  $("validation").classList.toggle("ok", !errors.length);
  $("json-editor").value = JSON.stringify(draft, null, 2);
  void chrome.storage.session.set({ editorDraft: draft });
}
function renderDraft() {
  $("editor").hidden = !draft; if (!draft) return;
  $("workflow-name").value = draft.name; $("workflow-goal").value = draft.goal;
  $("reviewed").checked = draft.learning?.reviewed === true;
  $("learning-method").textContent = draft.learning?.method === "local-draft" ? "Local draft · AI not used" : "Imported workflow";
  $("steps").replaceChildren(...draft.steps.map((step, index) => {
    const row = element("li", undefined, "step");
    const heading = element("div", undefined, "step-heading"); heading.append(element("span", String(index + 1).padStart(2, "0"), "index"), element("span", step.action));
    const remove = element("button", "Remove", "remove"); remove.onclick = () => { draft.steps.splice(index, 1); renderDraft(); }; heading.append(remove);
    row.append(heading, element("p", step.target?.description || step.url));
    if (step.action === "navigate") {
      const url = element("input"); url.value = step.url; url.setAttribute("aria-label", `Step ${index + 1} URL`); url.onchange = () => { step.url = url.value; checkDraft(); }; row.append(url);
    }
    if (step.value !== undefined) {
      const reference = step.value && typeof step.value === "object";
      const valueLabel = element("label", step.action.startsWith("assert") ? "Expected result" : "Demonstrated value");
      const value = element("input"); value.type = step.action === "check" ? "checkbox" : "text";
      const current = reference ? draft.inputs[step.value.input]?.default : step.value;
      if (value.type === "checkbox") value.checked = !!current; else value.value = current ?? "";
      value.setAttribute("aria-label", `Step ${index + 1} value`);
      value.onchange = () => { const updated = value.type === "checkbox" ? value.checked : value.value; if (step.value && typeof step.value === "object") draft.inputs[step.value.input].default = updated; else step.value = updated; checkDraft(); };
      row.append(valueLabel, value);
      const variableLabel = element("label", undefined, "check-row");
      const variable = element("input"); variable.type = "checkbox"; variable.checked = !!reference;
      variableLabel.append(variable, document.createTextNode("Change this value on each run")); row.append(variableLabel);
      const key = element("input"); key.placeholder = "Input name, e.g. customerName"; key.value = reference ? step.value.input : `input${index + 1}`; key.hidden = !reference;
      key.setAttribute("aria-label", `Step ${index + 1} input name`); row.append(key);
      variable.onchange = () => {
        if (variable.checked) {
          if (!safeKey(key.value)) { variable.checked = false; notice("Use a simple input name starting with a letter.", true); return; }
          const literal = step.value; draft.inputs[key.value] ??= { type: typeof literal, default: literal, required: true };
          step.value = { input: key.value };
        } else {
          const oldKey = step.value.input; step.value = draft.inputs[oldKey].default;
          if (!draft.steps.some(item => item.value?.input === oldKey)) delete draft.inputs[oldKey];
        }
        renderDraft();
      };
      key.onchange = () => {
        if (!safeKey(key.value)) { notice("Input names must start with a letter and contain letters, digits, underscores, or hyphens.", true); return; }
        const previous = step.value.input;
        draft.inputs[key.value] ??= clone(draft.inputs[previous]); step.value.input = key.value;
        if (!draft.steps.some(item => item.value?.input === previous)) delete draft.inputs[previous];
        renderDraft();
      };
    }
    return row;
  }));
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
bind("draft", async () => { const item = selectedRecording(); if (!item) throw new Error("Record a task first."); draft = (await call({ type: "DRAFT", id: item.id })).workflow; renderDraft(); });
bind("export-recording", () => { const item = selectedRecording(); if (!item) throw new Error("Choose a recording."); if (item.status === "recording") throw new Error("Stop recording first."); const exported = clone(item); delete exported.tabId; download(`follow-my-lead-${item.id}.recording.json`, exported); });
bind("copy-prompt", async () => { const item = selectedRecording(); if (!item) throw new Error("Choose a recording."); await navigator.clipboard.writeText(teachingPrompt(item)); notice("Teaching prompt copied. Paste it in this Codex project and attach the exported recording."); });
$("import-workflow").onchange = async event => {
  try { const file = event.target.files[0]; if (!file) return; if (file.size > 2_000_000) throw new Error("Choose a workflow smaller than 2 MB."); const parsed = JSON.parse(await file.text()); const errors = validateBrowserRun(parsed); if (errors.length) throw new Error(errors.join(" ")); draft = parsed; draft.learning = { ...draft.learning, reviewed: false }; renderDraft(); }
  catch (error) { notice(error.message, true); } finally { event.target.value = ""; }
};
for (const id of ["workflow-name", "workflow-goal", "reviewed"]) $(id).onchange = checkDraft;
bind("save", async () => { if (!draft) throw new Error("Create or import a workflow first."); checkDraft(); if (!draft.learning.reviewed) throw new Error("Review the workflow and check the review box."); const result = await call({ type: "SAVE_WORKFLOW", workflow: draft }); draft = result.workflow; renderDraft(); notice("Task saved. Enter its next inputs below and run it."); });
bind("export-workflow", () => { checkDraft(); const errors = validateBrowserRun(draft); if (errors.length) throw new Error(errors.join(" ")); download(`${draft.id}.workflow.json`, draft); });
bind("apply-json", () => { const parsed = JSON.parse($("json-editor").value); const errors = validateBrowserRun(parsed); if (errors.length) throw new Error(errors.join(" ")); draft = parsed; draft.learning = { ...draft.learning, reviewed: false }; renderDraft(); });
$("workflows").onchange = renderInputs;
bind("edit-saved", () => { const item = selectedWorkflow(); if (!item) throw new Error("Choose a saved task."); draft = clone(item); renderDraft(); });
bind("run", async () => {
  const workflow = selectedWorkflow(); if (!workflow) throw new Error("Save a reviewed task first.");
  await grant(Object.values(workflow.contexts)[0].origin);
  const inputs = {}; for (const control of $("run-inputs").querySelectorAll("input")) inputs[control.dataset.input] = control.type === "checkbox" ? control.checked : control.value;
  await call({ type: "RUN", workflow, inputs }); notice("Running in a new tab. Keep Chrome open; the result will be verified here.");
});
bind("stop-run", () => call({ type: "STOP" }));
try { await refresh(); const session = await chrome.storage.session.get("editorDraft"); if (session.editorDraft) { draft = session.editorDraft; renderDraft(); } }
catch (error) { notice(error.message, true); }
setInterval(() => { if (!busy) void refresh().catch(error => notice(error.message, true)); }, 1500);
