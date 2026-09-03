import { readFile, readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
async function walk(directory) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, item.name);
    if (item.isDirectory()) await walk(filename);
    else if (/\.(?:js|mjs)$/.test(item.name)) {
      const check = spawnSync(process.execPath, ["--check", filename], { encoding: "utf8" });
      if (check.status !== 0) throw new Error(check.stderr);
    }
  }
}
for (const folder of ["extension", "scripts", "demo", "tests"]) await walk(path.join(root, folder));
const manifest = JSON.parse(await readFile(path.join(root, "extension/manifest.json"), "utf8"));
for (const filename of [manifest.background.service_worker, manifest.action.default_popup, manifest.options_page]) await readFile(path.join(root, "extension", filename));
process.stdout.write("JavaScript syntax and extension entry points checked.\n");
