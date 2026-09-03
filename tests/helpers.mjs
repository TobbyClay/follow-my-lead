import { JSDOM } from "jsdom";
import { readFile } from "node:fs/promises";
export const root = new URL("../", import.meta.url);
export const files = new Map(await Promise.all(["browser/dom.js", "browser/recorder.js", "browser/content.js"].map(async file => [file, await readFile(new URL(`extension/${file}`, root), "utf8")])));
export const demoHTML = await readFile(new URL("demo/index.html", root), "utf8");
export const demoJS = await readFile(new URL("demo/demo.js", root), "utf8");
export const example = JSON.parse(await readFile(new URL("examples/find-customer.workflow.json", root), "utf8"));
export function page(html = demoHTML, url = "http://127.0.0.1:8765/") {
  const dom = new JSDOM(html, { url, runScripts: "outside-only", pretendToBeVisual: true });
  dom.window.eval(files.get("browser/dom.js")); dom.window.eval(files.get("browser/recorder.js"));
  return dom;
}
export function attachContent(dom) {
  const listeners = [];
  dom.window.chrome = { runtime: { sendMessage: async () => ({}), onMessage: { addListener: listener => listeners.push(listener) } } };
  dom.window.eval(files.get("browser/content.js"));
  return message => new Promise(resolve => listeners[0](message, {}, resolve));
}
export function enter(window, input, value) { input.value = value; input.dispatchEvent(new window.Event("input", { bubbles: true })); }
