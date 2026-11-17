import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { apply } from "./src/index.js";

const dir = await mkdtemp(join(tmpdir(), "sim-route-"));
let captured = null;
const stub = { register(route) { captured = route; return () => {}; } };
const logs = [];
const agents = [];
const ctx = {
  logger: { info: (m) => logs.push("info " + m), warn: (m) => logs.push("warn " + m) },
  agents: { list: () => agents },
  on: () => () => {},
  effect: (factory) => { const d = factory(); return () => { try { d?.(); } catch {} }; },
  commands: { register: () => () => {} },
  get: (name) => (name === "webServer" ? stub : undefined),
  webServer: stub
};
await apply(ctx, { dataDir: dir, threadsStorage: join(dir, "none.json") });
console.log("route registered:", captured ? captured.path + " (" + captured.kind + ")" : "NO");
if (captured) {
  let body = "";
  const res = {
    writeHead(code, headers) { this.code = code; this.headers = headers; },
    end(text) { body = String(text); }
  };
  const req = { method: "POST", on() {} };
  await captured.handler(req, res);
  console.log("status:", res.code, "| content-type:", res.headers?.["content-type"]);
  const parsed = JSON.parse(body);
  console.log("ok:", parsed.ok, "| projects:", Array.isArray(parsed.projects) ? parsed.projects.length : "n/a");
}
console.log("logs:", logs.slice(0, 3).join(" | "));
