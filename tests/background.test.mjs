import test from "node:test";
import assert from "node:assert/strict";
import { page, files, demoJS, example } from "./helpers.mjs";

// Exercise the real worker and content scripts together over a simulated Chrome transport.
// This checks orchestration, not Chrome permission dialogs or extension installation.
const memory = { recordings: [], workflows: [], run: null };
const tabs = new Map(); const scriptIds = new Map(); const backgroundListeners = []; const removedListeners = [];
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
  assert.equal(run.log.length, 4);
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
