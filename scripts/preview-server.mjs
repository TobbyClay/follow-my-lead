// Development-only review UI preview. No Chrome recording or replay is simulated as real.
import http from "node:http";
import { readFile } from "node:fs/promises";
const root = new URL("../", import.meta.url);
const routes = new Map([
  ["/", "extension/ui/control.html"], ["/control.css", "extension/ui/control.css"],
  ["/preview.js", "demo/review-preview.js"], ["/example.json", "examples/find-customer.workflow.json"],
  ["/extension/ui/control.js", "extension/ui/control.js"],
  ["/extension/core/workflow.js", "extension/core/workflow.js"], ["/extension/core/learning.js", "extension/core/learning.js"]
]);
http.createServer(async (request, response) => {
  const pathname = new URL(request.url, "http://127.0.0.1").pathname, file = routes.get(pathname);
  if (!file || request.method !== "GET") { response.writeHead(404).end(); return; }
  try {
    let content = await readFile(new URL(file, root), "utf8");
    if (pathname === "/") content = content.replace('src="control.js"', 'src="/preview.js"');
    const type = file.endsWith(".html") ? "text/html" : file.endsWith(".css") ? "text/css" : file.endsWith(".json") ? "application/json" : "text/javascript";
    response.writeHead(200, { "Content-Type": `${type}; charset=utf-8`, "Cache-Control": "no-store" }).end(content);
  } catch { response.writeHead(500).end("Preview unavailable"); }
}).listen(8766, "127.0.0.1", () => process.stdout.write("Development-only review UI: http://127.0.0.1:8766/\n"));
