import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { apply } from "./src/index.js";

const dir = await mkdtemp(join(tmpdir(), "sim2-"));
let captured = null;
const stub = { register(route) { captured = route; return () => {}; } };
const logs = [];
const ctx = {
  logger: { info: (m) => logs.push("info " + m), warn: (m) => logs.push("warn " + m) },
  agents: { list: () => [] },
  on: () => () => {},
  effect: (factory) => { const d = factory(); return () => { try { d?.(); } catch {} }; },
  commands: { register: () => () => {} },
  get: (name) => (name === "webServer" ? stub : undefined),
  webServer: stub
};
await apply(ctx, { dataDir: dir, threadsStorage: join(dir, "none.json") });
console.log("route:", captured ? captured.path + " (" + captured.kind + ")" : "NO ROUTE");
if (captured) {
  let body = "";
  const res = { writeHead(c, h) { this.code = c; this.h = h; }, end(t) { body = String(t); } };
  await captured.handler({ method: "POST", on() {} }, res);
  const parsed = JSON.parse(body);
  console.log("status:", res.code, "| ok:", parsed.ok, "| projects:", Array.isArray(parsed.projects) ? parsed.projects.length : "n/a");
}
console.log("logs:", logs.slice(0, 2).join(" | "));
process.exit(0);
