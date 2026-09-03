(() => {
  if (globalThis.FMLContent) return;
  globalThis.FMLContent = true;
  const dom = globalThis.FMLDOM;
  let recorder, recordingId, cancelled = false, hud, pending = Promise.resolve();
  const send = message => chrome.runtime.sendMessage(message);
  function banner(text) {
    hud?.remove(); hud = document.createElement("div"); hud.dataset.fmlUi = "true";
    hud.setAttribute("role", "status");
    Object.assign(hud.style, { position: "fixed", right: "18px", bottom: "18px", zIndex: "2147483647", background: "#172c29", color: "white", padding: "14px 18px", borderRadius: "12px", boxShadow: "0 6px 30px #0003", font: "14px system-ui", maxWidth: "320px" });
    const label = document.createElement("span"); label.textContent = text; hud.append(label);
    const stop = document.createElement("button"); stop.textContent = "Stop"; stop.style.cssText = "margin-left:14px;color:#fff;background:#37524c;border:0;border-radius:5px;padding:5px 10px;cursor:pointer";
    stop.onclick = () => { cancelled = true; recorder?.stop(); void pending.then(() => send({ type: "STOP" })); hud?.remove(); };
    hud.append(stop); document.documentElement.append(hud);
  }
  function record(id) {
    if (recordingId === id && recorder?.active) return;
    recorder?.stop(); recordingId = id;
    recorder = new globalThis.FMLRecorder(event => {
      pending = pending.then(() => send({ type: "EVENT", recordingId: id, event })).catch(error => {
        recorder.stop(); banner(`Recording paused: ${error.message}`);
      });
    });
    recorder.onSuccess = () => banner("Success check captured. Stop when you’re finished.");
    recorder.start(); banner("Recording this tab · Follow My Lead");
  }
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  async function execute(step, origin) {
    cancelled = false;
    if (location.origin !== origin) throw new Error("The tab left the workflow’s website.");
    const deadline = Date.now() + (step.timeoutMs || 8000);
    let element;
    do {
      if (cancelled) throw new Error("Run stopped.");
      element = dom.resolve(step.target);
      if (element && !element.disabled && element.getAttribute("aria-disabled") !== "true") break;
      element = null; await delay(100);
    } while (Date.now() < deadline);
    if (!element) throw new Error(`Could not find ${step.target.description}.`);
    const assertion = step.action.startsWith("assert");
    if (!assertion) {
      if (dom.isSensitive(element)) throw new Error("This control is excluded from replay.");
      element.scrollIntoView?.({ block: "center" }); element.focus?.();
    }
    if (step.action === "fill" || step.action === "select") {
      if (step.action === "select" && ![...element.options].some(option => option.value === step.value)) throw new Error("The requested selection is unavailable.");
      dom.setValue(element, step.value);
      if (element.value !== step.value) throw new Error("The page did not retain the entered value.");
    } else if (step.action === "check") {
      if (!["checkbox", "radio"].includes(element.type)) throw new Error("Target is not a checkbox or radio button.");
      if (element.checked !== step.value) element.click();
      if (element.checked !== step.value) throw new Error("The checkbox did not change as expected.");
    } else if (step.action === "click") element.click();
    else if (step.action === "press") {
      if (step.key !== "Enter") throw new Error("This browser adapter currently replays Enter only.");
      const allowed = element.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true, cancelable: true }));
      element.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", bubbles: true }));
      if (allowed && element.form) element.form.requestSubmit();
    } else if (assertion) {
      if (step.action === "assertText" && !step.value.trim()) throw new Error("An empty text check cannot prove success.");
      while (Date.now() < deadline) {
        if (cancelled) throw new Error("Run stopped.");
        element = dom.resolve(step.target);
        if (element) {
          const actual = step.action === "assertValue" ? element.value : dom.normalize(element.textContent);
          if (step.action === "assertValue" || step.match === "equals" ? actual === step.value : actual.includes(step.value)) return { verified: true, actual };
        }
        await delay(100);
      }
      throw new Error(`Success check failed: ${step.target.description}.`);
    } else throw new Error(`Unsupported browser action: ${step.action}`);
    return { dispatched: true };
  }
  chrome.runtime.onMessage.addListener((message, _sender, reply) => {
    (async () => {
      if (message.type === "HELLO") return { observation: dom.observe() };
      if (message.type === "RECORD") { record(message.recordingId); return {}; }
      if (message.type === "MARK_SUCCESS") {
        if (!recorder?.active) throw new Error("Start a recording first.");
        recorder.flush(); recorder.successMode = true; banner("Click the result that proves this task worked."); return {};
      }
      if (message.type === "HALT") { cancelled = true; recorder?.stop(); await pending; hud?.remove(); return {}; }
      if (message.type === "EXECUTE") return execute(message.step, message.origin);
      throw new Error("Unknown content command.");
    })().then(result => reply({ ok: true, ...result })).catch(error => reply({ ok: false, error: error.message }));
    return true;
  });
  void send({ type: "READY", observation: dom.observe() }).then(result => {
    if (result?.recordingId) record(result.recordingId);
  }).catch(() => {});
})();
