import { clone, draftWorkflow, httpURL, materialize, resolveInputs, slug, validateBrowserRun } from "./core/workflow.js";

const FILES = ["browser/dom.js", "browser/recorder.js", "browser/content.js"];
let queue = Promise.resolve();
let running = false;
let cancelled = false;
const serial = task => { const next = queue.then(task); queue = next.catch(() => {}); return next; };
const read = async () => ({ recordings: [], workflows: [], run: null, ...await chrome.storage.local.get(["recordings", "workflows", "run"]) });
const save = data => chrome.storage.local.set(data);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const pattern = origin => { const url = new URL(origin); return `${url.protocol}//${url.hostname}/*`; };
const recordingNow = state => state.recordings.find(item => item.status === "recording");
function cleanURL(value) {
  const url = httpURL(value);
  if (!url) throw new Error("Choose a normal HTTP or HTTPS website.");
  for (const key of [...url.searchParams.keys()]) if (/password|passcode|secret|token|api.?key|^(code|key|auth|authorization)$/i.test(key)) url.searchParams.delete(key);
  if (/token|secret|password/i.test(url.hash)) url.hash = "";
  return url.href;
}

async function provision(origin) {
  const site = pattern(origin);
  if (!await chrome.permissions.contains({ origins: [site] })) throw new Error("Allow access to the workflow’s website first.");
  const id = `fml-${slug(origin)}-${[...origin].reduce((hash, char) => ((hash * 31) + char.charCodeAt(0)) >>> 0, 0)}`;
  if (!(await chrome.scripting.getRegisteredContentScripts({ ids: [id] })).length) {
    await chrome.scripting.registerContentScripts([{ id, matches: [site], js: FILES, runAt: "document_idle", persistAcrossSessions: false }]);
  }
}

async function content(tabId, message) {
  const result = await chrome.tabs.sendMessage(tabId, message, { frameId: 0 });
  if (!result?.ok) throw new Error(result?.error || "The page did not respond.");
  return result;
}

async function ready(tabId, origin) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (cancelled && running) throw new Error("Run stopped.");
    const tab = await chrome.tabs.get(tabId);
    const url = httpURL(tab.url);
    if (url && url.origin !== origin) throw new Error("The tab left the workflow’s website.");
    if (tab.status === "complete" && url?.origin === origin) {
      try { return await content(tabId, { type: "HELLO" }); }
      catch {
        try {
          await chrome.scripting.executeScript({ target: { tabId }, files: FILES });
          return await content(tabId, { type: "HELLO" });
        } catch { /* Navigation may replace the document while scripts attach. */ }
      }
    }
    await pause(150);
  }
  throw new Error("The page did not become ready within 15 seconds.");
}

async function start(message) {
  if (!message.name?.trim() || !message.goal?.trim()) throw new Error("Give this task a name and describe its expected result.");
  if (recordingNow(await read()) || running) throw new Error("Stop the current recording or run first.");
  const tab = await chrome.tabs.get(message.tabId);
  const startUrl = cleanURL(tab.url);
  const origin = new URL(startUrl).origin;
  await provision(origin);
  const hello = await ready(tab.id, origin);
  const recording = { schemaVersion: 1, kind: "recording", id: crypto.randomUUID(), name: message.name.trim(), goal: message.goal.trim(),
    createdAt: new Date().toISOString(), status: "recording", tabId: tab.id, startUrl, origin, events: [], observation: hello.observation, warnings: [] };
  await serial(async () => { const state = await read(); state.recordings.unshift(recording); await save({ recordings: state.recordings.slice(0, 30) }); });
  try { await content(tab.id, { type: "RECORD", recordingId: recording.id }); }
  catch (error) { await stop(); throw error; }
  await chrome.action.setBadgeText({ text: "REC" });
  await chrome.action.setBadgeBackgroundColor({ color: "#b74732" });
  return { recording };
}

async function stop() {
  cancelled = true;
  const state = await read();
  const recording = recordingNow(state);
  // Flush content events before taking the storage queue, avoiding a flush/queue deadlock.
  if (recording) {
    try { await content(recording.tabId, { type: "HALT" }); } catch { /* Closed tabs cannot flush. */ }
    await serial(async () => {
      const current = await read();
      const item = current.recordings.find(item => item.id === recording.id);
      if (item) { item.status = "stopped"; item.stoppedAt = new Date().toISOString(); }
      await save({ recordings: current.recordings });
    });
  }
  if (state.run?.status === "running") {
    try { await content(state.run.tabId, { type: "HALT" }); } catch { /* A navigation can close the old document. */ }
    await serial(async () => {
      const current = await read();
      if (current.run?.status === "running") { current.run.status = "stopped"; current.run.error = "Stopped by the user."; await save({ run: current.run }); }
    });
  }
  await chrome.action.setBadgeText({ text: "" });
  return {};
}

async function appendEvent(message, sender) {
  return serial(async () => {
    const state = await read();
    const recording = recordingNow(state);
    if (!recording || recording.id !== message.recordingId || recording.tabId !== sender.tab?.id || sender.frameId !== 0) return {};
    if (httpURL(sender.url)?.origin !== recording.origin || httpURL(message.event?.url)?.origin !== recording.origin) return {};
    if (recording.events.some(event => event.eventId === message.event.eventId)) return {};
    if (recording.events.length >= 500) throw new Error("This pilot records up to 500 events; stop and split the task.");
    const event = clone(message.event);
    if (event.redacted) {
      delete event.value;
      const warning = "A sensitive field was excluded. Complete authentication before teaching the task.";
      if (!recording.warnings.includes(warning)) recording.warnings.push(warning);
    }
    const previous = recording.events.at(-1);
    if (event.action === "fill" && previous?.action === "fill" && JSON.stringify(event.target) === JSON.stringify(previous.target) && event.url === previous.url) recording.events[recording.events.length - 1] = event;
    else recording.events.push(event);
    await save({ recordings: state.recordings }); return {};
  });
}

async function onReady(message, sender) {
  const state = await read();
  const recording = recordingNow(state);
  if (!recording || recording.tabId !== sender.tab?.id || sender.frameId !== 0 || httpURL(sender.url)?.origin !== recording.origin) return {};
  await appendEvent({ recordingId: recording.id, event: { eventId: crypto.randomUUID(), action: "navigate", at: new Date().toISOString(), url: cleanURL(sender.url), pageTitle: message.observation.title } }, sender);
  return { recordingId: recording.id };
}

async function runWorkflow(message) {
  if (running || recordingNow(await read())) throw new Error("Stop the active task before running another.");
  const errors = validateBrowserRun(message.workflow);
  if (errors.length) throw new Error(errors.join(" "));
  const workflow = clone(message.workflow);
  if (workflow.learning?.reviewed !== true) throw new Error("Review the workflow before running it.");
  const inputs = resolveInputs(workflow, message.inputs);
  const origin = Object.values(workflow.contexts)[0].origin;
  await provision(origin);
  cancelled = false; running = true;
  try {
    const tab = await chrome.tabs.create({ url: workflow.steps[0].url });
    const run = { id: crypto.randomUUID(), workflowId: workflow.id, workflowRevision: workflow.revision, status: "running", startedAt: new Date().toISOString(), tabId: tab.id, index: 0, pendingStep: null, log: [] };
    await save({ run });
    void drive(workflow, inputs, run).finally(() => { running = false; });
    return { run };
  } catch (error) { running = false; throw error; }
}

async function drive(workflow, inputs, run) {
  try {
    for (let index = 0; index < workflow.steps.length; index++) {
      if (cancelled) throw new Error("Run stopped.");
      const step = materialize(workflow.steps[index], inputs);
      const origin = workflow.contexts[step.context].origin;
      await ready(run.tabId, origin);
      if (cancelled) throw new Error("Run stopped.");
      run.index = index; run.pendingStep = step.id;
      await save({ run }); // Persist intent before dispatch; an interrupted action is never replayed automatically.
      let result;
      if (step.action === "navigate") {
        if (index !== 0) { await chrome.tabs.update(run.tabId, { url: step.url }); await ready(run.tabId, origin); }
        result = { verified: true, url: step.url };
      } else result = await content(run.tabId, { type: "EXECUTE", step, origin });
      if (cancelled) throw new Error("Run stopped.");
      run.log.push({ stepId: step.id, action: step.action, at: new Date().toISOString(), result });
      run.pendingStep = null; await save({ run });
    }
    run.status = "succeeded"; run.finishedAt = new Date().toISOString();
  } catch (error) {
    run.status = cancelled ? "stopped" : "failed";
    run.error = error.message;
    if (run.pendingStep && !cancelled) run.error += " The current step was not retried; inspect its result before starting again.";
  }
  await save({ run });
}

async function handle(message, sender) {
  const pageMessage = ["EVENT", "READY"].includes(message.type);
  if (pageMessage && !sender.tab) throw new Error("This message requires a recording tab.");
  // Content scripts can report evidence and stop a task, but cannot start runs or import workflows.
  if (!pageMessage && message.type !== "STOP" && sender.tab && !sender.url?.startsWith(chrome.runtime.getURL(""))) throw new Error("Open Follow My Lead to issue that command.");
  if (message.type === "GET") {
    const state = await read();
    if (state.run?.status === "running" && !running) {
      state.run.status = "interrupted"; state.run.error = "The browser worker restarted. Inspect the last step; it has not been retried.";
      await save({ run: state.run });
    }
    const tabs = (await chrome.tabs.query({})).filter(tab => httpURL(tab.url)).map(tab => ({ id: tab.id, title: tab.title, url: tab.url, active: tab.active }));
    return { ...state, tabs };
  }
  if (message.type === "START") return start(message);
  if (message.type === "STOP") return stop();
  if (message.type === "EVENT") return appendEvent(message, sender);
  if (message.type === "READY") return onReady(message, sender);
  if (message.type === "MARK_SUCCESS") {
    const recording = recordingNow(await read());
    if (!recording) throw new Error("Start a recording first.");
    await chrome.tabs.update(recording.tabId, { active: true });
    return content(recording.tabId, { type: "MARK_SUCCESS" });
  }
  if (message.type === "DRAFT") {
    const recording = (await read()).recordings.find(item => item.id === message.id);
    if (!recording || recording.status === "recording") throw new Error("Stop the recording before creating its draft.");
    return { workflow: draftWorkflow(recording) };
  }
  if (message.type === "SAVE_WORKFLOW") {
    const errors = validateBrowserRun(message.workflow);
    if (errors.length) throw new Error(errors.join(" "));
    return serial(async () => {
      const state = await read(); const workflow = clone(message.workflow);
      const existing = state.workflows.find(item => item.id === workflow.id);
      workflow.revision = existing ? existing.revision + 1 : 1;
      state.workflows = [workflow, ...state.workflows.filter(item => item.id !== workflow.id)].slice(0, 50);
      await save({ workflows: state.workflows }); return { workflow };
    });
  }
  if (message.type === "RUN") return runWorkflow(message);
  if (message.type === "OPEN") { await chrome.runtime.openOptionsPage(); return {}; }
  throw new Error("Unknown extension command.");
}

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  handle(message, sender).then(result => reply({ ok: true, ...result })).catch(error => reply({ ok: false, error: error.message }));
  return true;
});

chrome.tabs.onRemoved.addListener(tabId => {
  void serial(async () => {
    const state = await read();
    const recording = recordingNow(state);
    if (recording?.tabId === tabId) { recording.status = "stopped"; recording.warnings.push("The recording tab was closed."); await save({ recordings: state.recordings }); await chrome.action.setBadgeText({ text: "" }); }
  });
});
