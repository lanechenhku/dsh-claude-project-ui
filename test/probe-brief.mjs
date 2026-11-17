
import { ProjectRegistry, defaultThreadsStorage } from "../src/project.js";
import { ProjectStore } from "../src/store.js";
import { resolveConfig } from "../src/config.js";
import { composeBrief } from "../src/tools.js";
const config = resolveConfig({});
const registry = new ProjectRegistry(defaultThreadsStorage());
const store = new ProjectStore(config);
const projects = await registry.projects();
const project = projects[0];
const role = await registry.roleOf(project.mainSessionId);
console.log("project:", project.title, "| role:", role.kind);
const brief = await composeBrief({ config, store, registry }, project, role.kind);
console.log("---- brief ----");
console.log(brief);
process.exit(0);
