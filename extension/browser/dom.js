(() => {
  if (globalThis.FMLDOM) return;
  const normalize = value => String(value ?? "").replace(/\s+/g, " ").trim();
  const sensitive = /password|passcode|secret|token|api.?key|credit.?card|card.?number|cvv|cvc|one.?time|\botp\b|social.?security/i;
  const internal = element => !!element?.closest?.("[data-fml-ui]");
  const label = element => normalize(element.getAttribute("aria-label") ||
    (element.getAttribute("aria-labelledby") || "").split(/\s+/).map(id => document.getElementById(id)?.textContent || "").join(" ") ||
    [...(element.labels || [])].map(item => item.textContent).join(" ") || element.getAttribute("placeholder"));
  const role = element => element.getAttribute("role") || ({ BUTTON: "button", A: "link", SELECT: "combobox", TEXTAREA: "textbox" }[element.tagName]) ||
    (element.tagName === "INPUT" ? (["submit", "button"].includes(element.type) ? "button" : ["checkbox", "radio"].includes(element.type) ? element.type : "textbox") : "");
  const name = element => label(element) || normalize(element.tagName === "INPUT" && ["button", "submit"].includes(element.type) ? element.value : element.textContent).slice(0, 160);
  const isSensitive = element => element.type === "password" || sensitive.test([element.name, element.id, element.autocomplete, label(element)].join(" "));
  const visible = element => {
    if (!element?.isConnected || internal(element) || element.closest("[hidden], [aria-hidden='true']")) return false;
    for (let item = element; item && item.nodeType === 1; item = item.parentElement) {
      const style = getComputedStyle(item);
      if (style.display === "none" || style.visibility === "hidden") return false;
    }
    return true;
  };
  const quote = value => JSON.stringify(String(value));
  function selector(element) {
    for (const attribute of ["data-testid", "id", "name", "aria-label"]) {
      const value = element.getAttribute(attribute);
      if (!value) continue;
      const candidate = `${element.tagName.toLowerCase()}[${attribute}=${quote(value)}]`;
      if (document.querySelectorAll(candidate).length === 1) return candidate;
    }
    const parts = [];
    for (let item = element; item && item !== document.body && parts.length < 6; item = item.parentElement) {
      const siblings = [...(item.parentElement?.children || [])].filter(sibling => sibling.tagName === item.tagName);
      parts.unshift(`${item.tagName.toLowerCase()}:nth-of-type(${siblings.indexOf(item) + 1})`);
      if (document.querySelectorAll(parts.join(" > ")).length === 1) return parts.join(" > ");
    }
    return parts.join(" > ");
  }
  function target(element) {
    const locators = [];
    if (label(element)) locators.push({ kind: "label", value: label(element) });
    if (role(element) && name(element)) locators.push({ kind: "role", role: role(element), value: name(element) });
    locators.push({ kind: "css", value: selector(element) });
    return { description: name(element) || element.tagName.toLowerCase(), tag: element.tagName.toLowerCase(), locators };
  }
  function resolve(target) {
    let ambiguous = false;
    for (const locator of target.locators || []) {
      let candidates = [];
      if (locator.kind === "css") {
        try { candidates = [...document.querySelectorAll(locator.value)]; } catch { throw new Error("Invalid CSS locator."); }
      } else if (locator.kind === "label") {
        candidates = [...document.querySelectorAll("input,textarea,select,button,[aria-label],[aria-labelledby]")].filter(element => label(element) === locator.value);
      } else if (locator.kind === "role") {
        candidates = [...document.querySelectorAll("button,a,input,select,textarea,[role]")].filter(element => role(element) === locator.role && name(element) === locator.value);
      } else if (locator.kind === "text") {
        candidates = [...document.querySelectorAll("body *")].filter(element => normalize(element.textContent) === locator.value && ![...element.children].some(child => normalize(child.textContent) === locator.value));
      }
      candidates = candidates.filter(visible);
      if (candidates.length === 1) return candidates[0];
      // Never disambiguate two equally named controls using a brittle positional fallback.
      if (candidates.length > 1) { ambiguous = true; break; }
    }
    if (ambiguous) throw new Error(`Ambiguous target: ${target.description}.`);
    return null;
  }
  function safeURL(value) {
    const url = new URL(value, location.href);
    for (const key of [...url.searchParams.keys()]) if (sensitive.test(key) || /^(code|key|auth|authorization)$/i.test(key)) url.searchParams.delete(key);
    if (sensitive.test(url.hash)) url.hash = "";
    url.username = ""; url.password = "";
    return url.href;
  }
  function observe() {
    return { url: safeURL(location.href), title: document.title,
      headings: [...document.querySelectorAll("h1,h2")].filter(visible).slice(0, 12).map(element => normalize(element.textContent).slice(0, 180)),
      controls: [...document.querySelectorAll("input,select,textarea,button,a,[role='button']")].filter(element => visible(element) && !isSensitive(element)).slice(0, 60).map(target) };
  }
  function setValue(element, value) {
    if (isSensitive(element)) throw new Error("This field is excluded from automated entry.");
    if (!["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName)) throw new Error("This editable control is not supported yet.");
    if (element.type === "file") throw new Error("Native file pickers require a later adapter.");
    const proto = element.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : element.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }
  globalThis.FMLDOM = { normalize, internal, label, role, name, isSensitive, visible, target, resolve, safeURL, observe, setValue };
})();
