import { createTeachingDraft } from "/extension/core/learning.js";
const workflow = await (await fetch("/example.json")).json();
function recording(name) {
  return { schemaVersion: 1, kind: "recording", id: name, name: `Find ${name}`, goal: workflow.goal, status: "stopped", startUrl: workflow.steps[0].url,
    events: workflow.steps.slice(1).map((step, index) => ({ ...structuredClone(step), eventId: `event-${index}`, url: workflow.steps[0].url, value: step.value?.input ? index === 0 ? name : name === "Maya" ? "Maya Chen" : "Noah Silva" : step.value })) };
}
const recordings = [recording("Maya"), recording("Noah")];
const state = { recordings, workflows: [], verifications: {}, tabs: [], run: null };
let editorDraft = createTeachingDraft(recordings[0], recordings[1]);
globalThis.chrome = {
  runtime: { sendMessage: async message => {
    if (message.type === "GET") return { ok: true, ...structuredClone(state) };
    if (message.type === "DRAFT") return { ok: true, workflow: createTeachingDraft(recordings.find(item => item.id === message.id), recordings.find(item => item.id === message.comparisonId)) };
    if (message.type === "SAVE_WORKFLOW") { const saved = structuredClone(message.workflow); saved.revision = (state.workflows[0]?.revision || 0) + 1; state.workflows = [saved]; return { ok: true, workflow: saved }; }
    return { ok: false, error: "UI preview only. Load the extension in Chrome to record or run a task." };
  } },
  storage: { session: { get: async () => ({ editorDraft }), set: async data => { editorDraft = structuredClone(data.editorDraft); } } },
  permissions: { request: async () => false }
};
await import("/extension/ui/control.js");
document.querySelector(".eyebrow").textContent = "DEVELOPMENT PREVIEW · NO REAL BROWSER RUNS";
