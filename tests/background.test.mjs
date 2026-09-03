import test from "node:test";
import assert from "node:assert/strict";
import { page, files, demoJS, example } from "./helpers.mjs";

// Exercise the real worker and content scripts together over a simulated Chrome transport.
// This checks orchestration, not Chrome permission dialogs or extension installation.
const memory = { recordings: [], workflows: [], run: null };
const tabs = new Map(); const scriptIds = new Map(); const backgroundListeners = []; const removedListeners = [];
const navigationListeners = {};
let nextTab = 1;
function messageToBackground(message, sender = { url: "chrome-extension://fml/ui/control.html" }) {
  return new Promise(resolve => backgroundListeners[0](message, sender, resolve));
}
async function attach(tabId) {
  const tab = tabs.get(tabId);
  if (tab.listener) return;
  const dom = page(undefined, tab.url); tab.dom = dom; dom.window.eval(demoJS);
  dom.window.chrome = { runtime: {
    sendMessage: message => messageToBackground(message, { tab: { id: tabId }, frameId: 0, url: tab.url }),
    onMessage: { addListener: listener => { tab.listener = listener; } }
  } };
  dom.window.eval(files.get("browser/content.js"));
}
globalThis.chrome = {
  webNavigation: Object.fromEntries(["onCommitted", "onHistoryStateUpdated", "onReferenceFragmentUpdated", "onCreatedNavigationTarget"].map(name => [name, { addListener: callback => { navigationListeners[name] = callback; } }])),
  runtime: { getURL: suffix => `chrome-extension://fml/${suffix}`, onMessage: { addListener: listener => backgroundListeners.push(listener) }, openOptionsPage: async () => {} },
  action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
  permissions: { contains: async () => true },
  storage: { local: {
    get: async keys => Object.fromEntries(keys.map(key => [key, structuredClone(memory[key])])),
    set: async data => Object.assign(memory, structuredClone(data))
  } },
  scripting: {
    getRegisteredContentScripts: async ({ ids }) => ids.filter(id => scriptIds.has(id)).map(id => scriptIds.get(id)),
    registerContentScripts: async scripts => { for (const script of scripts) scriptIds.set(script.id, script); },
    executeScript: async ({ target }) => attach(target.tabId)
  },
  tabs: {
    query: async () => [...tabs.values()].map(({ dom, listener, ...tab }) => tab),
    get: async id => { const tab = tabs.get(id); if (!tab) throw new Error("Tab closed"); const { dom, listener, ...summary } = tab; return summary; },
    create: async ({ url }) => { const id = nextTab++; const tab = { id, url, status: "complete", title: "Practice", active: true }; tabs.set(id, tab); return { ...tab }; },
    update: async (id, update) => { const tab = tabs.get(id); if (update.url) { tab.dom?.window.close(); tab.listener = null; tab.dom = null; } Object.assign(tab, update); return { id, url: tab.url, status: "complete" }; },
    sendMessage: async (id, message) => { const tab = tabs.get(id); if (!tab?.listener) throw new Error("Receiving end does not exist"); return new Promise(resolve => tab.listener(message, {}, resolve)); },
    onRemoved: { addListener: listener => removedListeners.push(listener) }
  }
};
await import("../extension/background.js");
async function waitForRun() {
  const deadline = Date.now() + 3000;
  while (memory.run?.status === "running" && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 30));
  assert.notEqual(memory.run?.status, "running", "run must finish");
  return memory.run;
}

test("worker executes the full workflow in a new tab and persists verified results", async () => {
  const response = await messageToBackground({ type: "RUN", workflow: example, inputs: { customerName: "Noah" } });
  assert.equal(response.ok, true, response.error);
  const run = await waitForRun();
  assert.equal(run.status, "succeeded", run.error);
  assert.equal(run.log.length, 5);
  assert.equal(run.log.at(-1).result.verified, true);
  assert.match(tabs.get(run.tabId).dom.window.document.getElementById("customers").textContent, /Noah Silva/);
});

test("worker blocks unreviewed or desktop workflows before opening a tab", async () => {
  const before = tabs.size;
  const unreviewed = structuredClone(example); unreviewed.learning.reviewed = false;
  const response = await messageToBackground({ type: "RUN", workflow: unreviewed, inputs: {} });
  assert.equal(response.ok, false); assert.match(response.error, /Review/);
  const desktop = structuredClone(example); desktop.contexts.main.adapter = "windows";
  assert.equal((await messageToBackground({ type: "RUN", workflow: desktop, inputs: {} })).ok, false);
  assert.equal(tabs.size, before);
});

test("content scripts cannot authorize a workflow run", async () => {
  const response = await messageToBackground({ type: "RUN", workflow: example }, { tab: { id: 1 }, frameId: 0, url: "http://127.0.0.1:8765/" });
  assert.equal(response.ok, false); assert.match(response.error, /Open Follow My Lead/);
});

test("worker persists recording events and stops without a flush deadlock", async () => {
  const tab = await chrome.tabs.create({ url: "http://127.0.0.1:8765/" });
  const started = await messageToBackground({ type: "START", tabId: tab.id, name: "Demo", goal: "Find a customer" });
  assert.equal(started.ok, true, started.error);
  const event = { eventId: "event-1", action: "fill", value: "Maya", url: tab.url, target: example.steps[1].target };
  const sender = { tab, frameId: 0, url: tab.url };
  assert.equal((await messageToBackground({ type: "EVENT", recordingId: started.recording.id, event }, sender)).ok, true);
  await messageToBackground({ type: "EVENT", recordingId: started.recording.id, event }, sender);
  const stopped = await messageToBackground({ type: "STOP" });
  assert.equal(stopped.ok, true, stopped.error);
  assert.equal(memory.recordings[0].status, "stopped");
  assert.equal(memory.recordings[0].events.filter(event => event.eventId === "event-1").length, 1);
});

test("a saved in-flight step is marked interrupted rather than automatically retried", async () => {
  memory.run = { id: "prior-run", status: "running", pendingStep: "submit", log: [] };
  const result = await messageToBackground({ type: "GET" });
  assert.equal(result.run.status, "interrupted");
  assert.equal(result.run.pendingStep, "submit");
});

test.after(() => { for (const tab of tabs.values()) tab.dom?.window.close(); delete globalThis.chrome; });

async function until(predicate) {
  const deadline = Date.now() + 3000;
  while (!predicate() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
  assert.ok(predicate());
}

test("navigation evidence distinguishes manual visits, SPA transitions, and reloads", async () => {
  const tab = await chrome.tabs.create({ url: "http://127.0.0.1:8765/" });
  const started = await messageToBackground({ type: "START", tabId: tab.id, name: "Navigation", goal: "Visit pages" });
  assert.equal(started.ok, true);
  navigationListeners.onCommitted({ tabId: tab.id, frameId: 0, url: tab.url + "reports", transitionType: "typed", transitionQualifiers: ["from_address_bar"] });
  await until(() => memory.recordings[0].events.length === 1);
  assert.equal(memory.recordings[0].events[0].navigation.kind, "explicit");
  const sender = { tab, frameId: 0, url: tab.url + "reports" };
  await messageToBackground({ type: "EVENT", recordingId: started.recording.id, event: { eventId: "spa-click", action: "click", url: sender.url, target: example.steps[2].target } }, sender);
  navigationListeners.onHistoryStateUpdated({ tabId: tab.id, frameId: 0, url: tab.url + "reports?q=Maya", transitionType: "link", transitionQualifiers: [] });
  await until(() => memory.recordings[0].events.length === 3);
  assert.equal(memory.recordings[0].events[2].navigation.causeEventId, "spa-click");
  navigationListeners.onCommitted({ tabId: tab.id, frameId: 0, url: tab.url + "reports?q=Maya", transitionType: "reload", transitionQualifiers: [] });
  await until(() => memory.recordings[0].events.length === 4);
  assert.equal(memory.recordings[0].events[3].navigation.kind, "explicit");
  await messageToBackground({ type: "STOP" });
});

test("leaving the approved site stops recording and blocks a deceptively complete draft", async () => {
  const tab = await chrome.tabs.create({ url: "http://127.0.0.1:8765/" });
  const started = await messageToBackground({ type: "START", tabId: tab.id, name: "Boundary", goal: "Visit another app" });
  navigationListeners.onCommitted({ tabId: tab.id, frameId: 0, url: "https://other.test/private?token=secret", transitionType: "link" });
  await until(() => memory.recordings[0].status === "stopped");
  assert.match(memory.recordings[0].warnings.join(" "), /approved website/);
  assert.doesNotMatch(JSON.stringify(memory.recordings[0]), /token=secret/);
  const draft = await messageToBackground({ type: "DRAFT", id: started.recording.id });
  assert.match(draft.workflow.learning.unresolved.join(" "), /Recording stopped/);
});

test("only a passing different-input test verifies the saved revision; edits invalidate it", async () => {
  const saved = (await messageToBackground({ type: "SAVE_WORKFLOW", workflow: { ...example, verification: { status: "verified" } } })).workflow;
  assert.equal(saved.verification, undefined);
  assert.equal(memory.verifications?.[saved.id], undefined);
  const before = tabs.size;
  const unchanged = await messageToBackground({ type: "RUN", workflow: saved, inputs: { customerName: "Maya" }, mode: "test" });
  assert.equal(unchanged.ok, false); assert.equal(tabs.size, before);
  assert.match(unchanged.error, /Change at least one/);
  assert.equal((await messageToBackground({ type: "RUN", workflow: saved, inputs: { customerName: "Noah" } })).ok, true);
  assert.equal((await waitForRun()).status, "succeeded");
  assert.equal(memory.verifications?.[saved.id], undefined);
  assert.equal((await messageToBackground({ type: "RUN", workflow: saved, inputs: { customerName: "Noah" }, mode: "test" })).ok, true);
  const tested = await waitForRun();
  assert.equal(tested.taskVerified, true, tested.error);
  assert.equal(memory.verifications[saved.id].status, "verified");
  assert.deepEqual(memory.verifications[saved.id].changedInputs, ["customerName"]);
  const edited = (await messageToBackground({ type: "SAVE_WORKFLOW", workflow: saved })).workflow;
  assert.equal(edited.revision, saved.revision + 1);
  assert.equal(memory.verifications[saved.id], undefined);
});

test("a revision edited while its transfer test runs cannot inherit the old proof", async () => {
  const saved = (await messageToBackground({ type: "SAVE_WORKFLOW", workflow: example })).workflow;
  assert.equal((await messageToBackground({ type: "RUN", workflow: saved, inputs: { customerName: "Noah" }, mode: "test" })).ok, true);
  await messageToBackground({ type: "SAVE_WORKFLOW", workflow: { ...saved, goal: "Edited goal" } });
  assert.equal((await waitForRun()).status, "succeeded");
  assert.equal(memory.verifications[saved.id], undefined);
});

test("manual navigation is executed, while a missing observed transition fails without opening its URL", async () => {
  const workflow = structuredClone(example);
  workflow.steps.splice(1, 0, { id: "visit-reports", context: "main", action: "navigate", url: "http://127.0.0.1:8765/reports" });
  assert.equal((await messageToBackground({ type: "RUN", workflow, inputs: { customerName: "Noah" } })).ok, true);
  assert.equal((await waitForRun()).status, "succeeded");
  assert.equal(tabs.get(memory.run.tabId).url, "http://127.0.0.1:8765/reports");
  workflow.steps[1].action = "waitForURL"; workflow.steps[1].timeoutMs = 200;
  assert.equal((await messageToBackground({ type: "RUN", workflow, inputs: { customerName: "Noah" } })).ok, true);
  const failed = await waitForRun();
  assert.equal(failed.status, "failed");
  assert.match(failed.error, /transition did not occur/);
  assert.equal(tabs.get(failed.tabId).url, example.steps[0].url);
});

test("a failed different-input test cannot create verified evidence", async () => {
  const workflow = structuredClone(example);
  for (const step of workflow.steps.filter(step => step.action.startsWith("assert"))) step.timeoutMs = 500;
  const saved = (await messageToBackground({ type: "SAVE_WORKFLOW", workflow })).workflow;
  assert.equal((await messageToBackground({ type: "RUN", workflow: saved, inputs: { customerName: "No such contact" }, mode: "test" })).ok, true);
  const failed = await waitForRun();
  assert.equal(failed.status, "failed");
  assert.equal(failed.taskVerified, false);
  assert.equal(memory.verifications[saved.id].status, "not-verified");
});

test("a new-tab action stops the original recording with a visible learning gap", async () => {
  const tab = await chrome.tabs.create({ url: example.steps[0].url });
  assert.equal((await messageToBackground({ type: "START", tabId: tab.id, name: "New tab", goal: "Open report" })).ok, true);
  navigationListeners.onCreatedNavigationTarget({ sourceTabId: tab.id, sourceFrameId: 0, tabId: 100 });
  await until(() => memory.recordings[0].status === "stopped");
  assert.match(memory.recordings[0].warnings.join(" "), /another tab/);
});
