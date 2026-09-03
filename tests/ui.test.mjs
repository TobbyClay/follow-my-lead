import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import { createTeachingDraft } from "../extension/core/learning.js";
import { example } from "./helpers.mjs";

test("review UI accepts and renames suggestions, displays teach-back, and keeps verification separate", async () => {
  const source = { schemaVersion: 1, kind: "recording", id: "recorded", name: "Customer lookup", goal: "Find the requested customer", status: "stopped", startUrl: example.steps[0].url, events: example.steps.slice(1).map((step, index) => ({ ...structuredClone(step), eventId: `event-${index}`, url: example.steps[0].url, value: step.value?.input ? index === 0 ? "Maya" : "Maya Chen" : step.value })) };
  const draft = createTeachingDraft(source);
  const dom = new JSDOM(await readFile(new URL("../extension/ui/control.html", import.meta.url), "utf8"), { url: "https://preview.example.test" });
  const memory = { recordings: [source, { ...source, id: "second", name: "Second demonstration" }], workflows: [{ ...structuredClone(example), verification: { status: "verified" } }], verifications: {}, tabs: [], run: null };
  let sessionDraft = draft, poll;
  const previous = { document: globalThis.document, window: globalThis.window, chrome: globalThis.chrome, setInterval: globalThis.setInterval };
  Object.assign(globalThis, { document: dom.window.document, window: dom.window, setInterval: callback => { poll = callback; return 1; }, chrome: {
    runtime: { sendMessage: async message => message.type === "GET" ? { ok: true, ...structuredClone(memory) } : { ok: true } },
    storage: { session: { get: async () => ({ editorDraft: sessionDraft }), set: async data => { sessionDraft = structuredClone(data.editorDraft); } } }
  } });
  try {
    await import(`../extension/ui/control.js?test=${Date.now()}`);
    const $ = id => dom.window.document.getElementById(id);
    assert.equal($("verification-status").textContent, "Not verified");
    assert.equal($("comparison").options.length, 2);
    const suggestion = $("input-suggestions").querySelector(".suggestion");
    suggestion.querySelector('[aria-label="Label for customerName"]').value = "Contact name";
    suggestion.querySelector('[aria-label="Input key for customerName"]').value = "contactName";
    [...suggestion.querySelectorAll("button")].find(button => button.textContent === "Accept input").click();
    const learned = JSON.parse($("json-editor").value);
    assert.equal(learned.inputs.contactName.description, "Contact name");
    assert.deepEqual(learned.steps.at(-1).value, { input: "contactName" });
    assert.match($("teach-back").textContent, /Contact name/);
    assert.match($("teach-back").textContent, /tested input and path/);
    assert.equal($("reviewed").checked, false);
    assert.equal(sessionDraft.inputs.contactName.default, "Maya");
    memory.verifications[example.id] = { status: "verified", workflowRevision: example.revision, changedInputs: ["customerName"] };
    poll(); await new Promise(resolve => setTimeout(resolve, 10));
    assert.match($("verification-status").textContent, /Verified/);
    memory.workflows[0].revision++;
    poll(); await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal($("verification-status").textContent, "Not verified");
  } finally {
    for (const [key, value] of Object.entries(previous)) if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    dom.window.close();
  }
});
