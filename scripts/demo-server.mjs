import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.FML_DEMO_PORT || 8765);
const routes = new Map([
  ["/", ["demo/index.html", "text/html"]], ["/demo.js", ["demo/demo.js", "text/javascript"]], ["/demo.css", ["demo/demo.css", "text/css"]],
  ["/example.workflow.json", ["examples/find-customer.workflow.json", "application/json"]]
]);
const server = http.createServer(async (request, response) => {
  const route = routes.get(new URL(request.url, "http://127.0.0.1").pathname);
  if (!route || request.method !== "GET") { response.writeHead(404); response.end("Not found"); return; }
  try {
    const file = await readFile(path.join(root, route[0]));
    response.writeHead(200, { "Content-Type": `${route[1]}; charset=utf-8`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }); response.end(file);
  } catch { response.writeHead(500); response.end("Could not load practice page."); }
});
server.listen(port, "127.0.0.1", () => process.stdout.write(`Follow My Lead practice task: http://127.0.0.1:${port}\nKeep this process running while testing. Ctrl+C stops it.\n`));
