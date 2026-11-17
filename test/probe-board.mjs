
import { ProjectRegistry, defaultThreadsStorage } from "../src/project.js";
import { ProjectStore } from "../src/store.js";
import { resolveConfig } from "../src/config.js";
import { boardView, boardText, loadBoard } from "../src/board.js";
const config = resolveConfig({});
const registry = new ProjectRegistry(defaultThreadsStorage());
const store = new ProjectStore(config);
const project = (await registry.projects())[0];
const threads = await registry.threadsOf(project.id);
const board = await loadBoard(store, project.id);
const view = boardView(project, threads, board);
console.log("== /hub board 现在会打印 ==");
console.log("项目：" + project.title);
console.log(boardText(view));
console.log("");
console.log("threads in registry:", threads.map(t => "#" + t.n + " " + t.status + (t.resolved ? " resolved" : "") + (t.archived ? " archived" : "")).join(" | "));
console.log("manual tasks:", board.tasks.length);
process.exit(0);
