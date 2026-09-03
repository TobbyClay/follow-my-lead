(() => {
  if (globalThis.FMLRecorder) return;
  const dom = globalThis.FMLDOM;
  class Recorder {
    constructor(emit, { trustedOnly = true } = {}) {
      this.emit = emit; this.trustedOnly = trustedOnly; this.active = false; this.pending = null; this.successMode = false;
      this.handlers = {
        input: event => this.onInput(event), change: event => this.onChange(event),
        click: event => this.onClick(event), keydown: event => this.onKey(event),
        pagehide: () => this.flush()
      };
    }
    start() {
      if (this.active) return;
      this.active = true;
      for (const [type, handler] of Object.entries(this.handlers)) addEventListener(type, handler, true);
    }
    stop() {
      this.flush(); this.active = false; this.successMode = false;
      for (const [type, handler] of Object.entries(this.handlers)) removeEventListener(type, handler, true);
    }
    accepts(event) { return this.active && (!this.trustedOnly || event.isTrusted) && event.target?.nodeType === 1 && !dom.internal(event.target); }
    send(action, element, extra = {}) {
      if (dom.isSensitive(element)) { extra = { redacted: true }; }
      this.emit({ eventId: crypto.randomUUID(), at: new Date().toISOString(), action,
        target: dom.target(element), url: dom.safeURL(location.href), pageTitle: document.title, ...extra });
    }
    flush() {
      clearTimeout(this.timer);
      if (this.pending) {
        const { element, value } = this.pending;
        this.pending = null;
        this.send("fill", element, dom.isSensitive(element) ? { redacted: true } : { value });
      }
    }
    onInput(event) {
      if (!this.accepts(event)) return;
      const element = event.target;
      if (!["INPUT", "TEXTAREA"].includes(element.tagName) || ["checkbox", "radio", "file", "hidden"].includes(element.type)) return;
      if (this.pending && this.pending.element !== element) this.flush();
      // Sensitive values never enter the pending buffer.
      this.pending = { element, value: dom.isSensitive(element) ? undefined : element.value };
      clearTimeout(this.timer); this.timer = setTimeout(() => this.flush(), 350);
    }
    onChange(event) {
      if (!this.accepts(event)) return;
      const element = event.target;
      if (element.tagName === "SELECT") { this.flush(); this.send("select", element, { value: element.value }); }
      else if (["checkbox", "radio"].includes(element.type)) { this.flush(); this.send("check", element, { value: element.checked }); }
      else this.flush();
    }
    onClick(event) {
      if (!this.accepts(event)) return;
      this.flush();
      if (this.successMode) {
        event.preventDefault(); event.stopImmediatePropagation(); this.successMode = false;
        const element = event.target;
        if (dom.isSensitive(element)) { this.send("assertText", element, { redacted: true }); return; }
        const isValue = ["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName);
        this.send(isValue ? "assertValue" : "assertText", element, { value: isValue ? element.value : dom.normalize(element.textContent).slice(0, 500), match: "contains" });
        this.onSuccess?.(); return;
      }
      const element = event.target.closest("button,a,input[type='submit'],input[type='button'],[role='button']");
      if (element?.form && element.form === this.enterForm && event.detail === 0 && Date.now() < this.enterDeadline && element.type === "submit") return;
      if (element && !dom.internal(element)) this.send("click", element);
    }
    onKey(event) {
      if (!this.accepts(event) || event.key !== "Enter" || !["INPUT", "TEXTAREA"].includes(event.target.tagName)) return;
      if (event.target.tagName === "TEXTAREA") return;
      this.flush(); this.enterForm = event.target.form; this.enterDeadline = Date.now() + 150;
      this.send("press", event.target, { key: "Enter" });
    }
  }
  globalThis.FMLRecorder = Recorder;
})();
