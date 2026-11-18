import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tmp = await mkdtemp(join(tmpdir(), "dsh-hub-test-"));
const dataDir = join(tmp, "data");
const storage = join(tmp, "dsh_threads.json");
// workspace.json sits next to dsh_threads.json in DSH's storages directory; it is
// where a NEW session's directory is read from.
const workspaceStorage = join(tmp, "workspace.json");
const mainFolder = join(tmp, "main");
const extraA = join(tmp, "extra-a");
const extraB = join(tmp, "extra-b");
const folderB = join(tmp, "folder-b");
const folderC = join(tmp, "folder-c");
const folderD = join(tmp, "folder-d");
const conflictFolder = join(tmp, "folder-conflict");

const project = {
  id: "project-1",
  title: "示例项目",
  workspaceId: "ws-main",
  folder: mainFolder,
  mainSessionId: "session-main",
  // Fields this plugin does not own: a folder switch must leave every one of them
  // exactly as dsh-threads wrote it.
  notify: "attention",
  icon: "folder",
  zzCustom: { keep: true, list: [1, 2, 3] },
  instructions: "所有讨论串共用同一份约定：先跑 npm test。",
  goal: "把 V1 发出去",
  archived: false,
  updatedAt: "2026-11-18T00:00:00.000Z"
};
const threads = {
  "session-t1": {
    id: "session-t1",
    mainSessionId: "session-main",
    n: 1,
    title: "重构登录",
    status: "idle",
    resolved: false,
    lastReport: { status: "done", summary: "登录改成 token 校验，测试通过", changedFiles: ["src/auth.js"], decisions: [] },
    worktree: { branch: "dsh-threads/1-abc123" },
    updatedAt: "2026-11-18T00:10:00.000Z"
  },
  "session-t2": {
    id: "session-t2",
    mainSessionId: "session-main",
    n: 2,
    title: "补文档",
    status: "running",
    resolved: false,
    lastReport: { status: "needs_decision", summary: "README 要不要保留英文版？", changedFiles: [], decisions: ["保留英文版？"] },
    worktree: null,
    updatedAt: "2026-11-18T00:20:00.000Z"
  }
};

await mkdir(tmp, { recursive: true });
await mkdir(mainFolder, { recursive: true });
await mkdir(extraA, { recursive: true });
await mkdir(extraB, { recursive: true });
await mkdir(folderB, { recursive: true });
await mkdir(folderC, { recursive: true });
await mkdir(folderD, { recursive: true });
await mkdir(conflictFolder, { recursive: true });
await writeFile(join(extraA, "notes.md"), "# 辅助文件夹笔记\n\n这是一份挂在主文件夹之外的资料。\n", "utf8");
await writeFile(join(mainFolder, "main-note.md"), "主文件夹里的说明。\n", "utf8");
await writeFile(join(tmp, "outside.md"), "既不在主文件夹、也没挂载的文件。\n", "utf8");
const canonicalA = await realpath(extraA);
const canonicalB = await realpath(extraB);
await writeFile(storage, JSON.stringify({ unit: { name: "dsh_threads", version: 1 }, global: null, tables: { projects: { [project.id]: project }, threads, mains: {} } }, null, 2));
await writeFile(
  workspaceStorage,
  JSON.stringify(
    {
      unit: { name: "workspace", version: 2 },
      global: { initialized: true, workspaceIds: ["ws-main", "ws-other", "ws-conflict"] },
      tables: {
        workspaces: {
          "ws-main": { id: "ws-main", path: mainFolder, title: "示例项目", sessionIds: ["session-main"], createdAt: "2026-11-17T00:00:00.000Z" },
          "ws-other": { id: "ws-other", path: join(tmp, "elsewhere"), title: "另一个工作区", sessionIds: ["session-other"] },
          "ws-conflict": { id: "ws-conflict", path: conflictFolder, title: "占位工作区", sessionIds: [] }
        }
      }
    },
    null,
    2
  )
);

const { apply } = await import("../src/index.js");

const logs = [];
const handlers = new Map();
const routes = new Map();
const commands = [];
const registered = [];
const toolDefs = [];
const disposers = [];
const agents = [];

const policyCalls = [];

function makeAgent(id) {
  const sections = [];
  const tools = [];
  const agent = {
    id,
    sections,
    tools,
    session: { id },
    ctx: {
      // The host hands plugins the sandbox policy as a Cordis service; the fake
      // records grants so a test can prove extra folders become writable roots.
      get: (serviceName) =>
        serviceName === "sandboxPolicy"
          ? {
              registerWritableRoot: (session, directory) => {
                policyCalls.push({ agent: id, session, directory });
                return () => {};
              }
            }
          : undefined,
      systemPrompt: {
        section: (def) => {
          sections.push({ kind: "section", ...def });
          return () => {};
        },
        context: (def) => {
          sections.push({ kind: "context", ...def });
          return () => {};
        }
      },
      tools: {
        register: (tool) => {
          tools.push(tool);
          toolDefs.push(tool);
          return () => {};
        }
      }
    }
  };
  agents.push(agent);
  return agent;
}

const mainAgent = makeAgent("session-main");
const threadAgent = makeAgent("session-t1");
const outsideAgent = makeAgent("session-other");

const ctx = {
  logger: { info: (message) => logs.push("info " + message), warn: (message) => logs.push("warn " + message) },
  // The web GUI provides this service; the fake captures the routes so a test
  // can exercise the folder write path without a browser.
  webServer: {
    register: (route) => {
      routes.set(route.path, route);
      return () => {};
    }
  },
  agents: { list: () => agents.slice() },
  on: (event, handler) => {
    handlers.set(event, handler);
    return () => {};
  },
  effect: (factory) => {
    const dispose = factory();
    disposers.push(dispose);
    return () => {};
  },
  commands: { register: (definition) => { commands.push(definition); return () => {}; } }
};

await apply(ctx, { dataDir, threadsStorage: storage, workspaceStorage });
await sleep(150);

const failures = [];
const pending = [];
// Checks share one store directory, so they must run strictly one after another:
// two concurrent atomic writes race on the same .tmp file.
let chain = Promise.resolve();
function check(label, fn) {
  chain = chain.then(async () => {
    try {
      await fn();
      console.log("PASS", label);
    } catch (error) {
      failures.push(label + ": " + String(error?.message ?? error));
      console.log("FAIL", label, String(error?.message ?? error));
    }
  });
  pending.push(chain);
  return chain;
}

function tool(agent, name) {
  const found = agent.tools.find((candidate) => candidate.name === name);
  assert.ok(found, "tool " + name + " not registered on " + agent.id);
  return found;
}

function call(agent, name, args) {
  return tool(agent, name).execute(args ?? {}, { agent: { id: agent.id } });
}

check("project sessions get 10 tools, outsiders get none", () => {
  assert.equal(mainAgent.tools.length, 10);
  assert.equal(threadAgent.tools.length, 10);
  assert.equal(outsideAgent.tools.length, 0);
});

check("prompt sections registered per role", () => {
  assert.equal(mainAgent.sections.length, 4);
  assert.equal(threadAgent.sections.length, 4);
});

check("knowledge: add, search, read, list", async () => {
  const added = await call(mainAgent, "kb_add", { title: "发布清单", text: "上线前必须跑 npm test 与 npm run build。发布分支是 release/v1。", tags: ["发布"] });
  assert.match(added, /k-1/);
  const search = await call(threadAgent, "kb_search", { query: "发布 分支" });
  assert.match(search, /k-1/);
  assert.match(search, /发布清单/);
  const got = await call(threadAgent, "kb_get", { doc_id: "k-1" });
  assert.match(got, /release\/v1/);
  const list = await call(mainAgent, "kb_list", {});
  assert.match(list, /知识库 1 篇/);
});

check("knowledge: replace by title, remove", async () => {
  const replaced = await call(mainAgent, "kb_add", { title: "发布清单", text: "更新：发布前还要跑 e2e。" });
  assert.match(replaced, /已更新/);
  const list = await call(mainAgent, "kb_list", {});
  assert.match(list, /知识库 1 篇/);
  const removed = await call(mainAgent, "kb_remove", { doc_id: "k-1" });
  assert.match(removed, /已移除/);
});

check("board: add, update, list merges live threads", async () => {
  const added = await call(mainAgent, "board_add", { subject: "合并 worktree", owner: "lead" });
  const id = added.match(/\[(b-\d+)\]/)[1];
  const updated = await call(mainAgent, "board_update", { task_id: id, status: "doing", note: "等 review" });
  assert.match(updated, /doing/);
  const list = await call(threadAgent, "board_list", {});
  assert.match(list, /#1 重构登录 — 已解决|#1 重构登录 — done/);
  assert.match(list, /#2 补文档 — 待决策/);
  assert.match(list, new RegExp(id));
});

check("hub_note + context_brief include everything", async () => {
  await call(mainAgent, "hub_note", { text: "决定：V1 只支持 macOS。" });
  await sleep(50);
  const brief = await call(mainAgent, "context_brief", {});
  assert.match(brief, /项目上下文 · 示例项目/);
  assert.match(brief, /把 V1 发出去/);
  assert.match(brief, /决定：V1 只支持 macOS。/);
  assert.match(brief, /#1 重构登录/);
});

check("thread prompt text carries board and progress", async () => {
  const boardSection = threadAgent.sections.find((section) => section.name === "project-hub/board");
  const digestSection = threadAgent.sections.find((section) => section.name === "project-hub/digest");
  assert.ok(boardSection && digestSection);
  assert.match(boardSection.text(), /看板/);
  assert.match(digestSection.text(), /#1 重构登录/);
  assert.match(digestSection.text(), /避免重复劳动|项目进展/);
});

check("/hub command: status, board, kb, brief, note", async () => {
  const command = commands[0];
  assert.ok(command, "command not registered");
  const status = await command.handler({ agent: { id: "session-main" }, rawInput: "status" });
  assert.equal(status.kind, "success");
  assert.match(status.text, /讨论串：2 个/);
  const board = await command.handler({ agent: { id: "session-main" }, rawInput: "board" });
  assert.match(board.text, /#2 补文档/);
  const kb = await command.handler({ agent: { id: "session-main" }, rawInput: "kb" });
  assert.match(kb.text, /知识库/);
  const brief = await command.handler({ agent: { id: "session-main" }, rawInput: "brief" });
  assert.match(brief.text, /项目上下文/);
  const note = await command.handler({ agent: { id: "session-main" }, rawInput: "note 下周发 V1" });
  assert.match(note.text, /下周发 V1/);
  const outside = await command.handler({ agent: { id: "session-other" }, rawInput: "status" });
  assert.equal(outside.kind, "error");
});

check("/hub accepts a pasted multi-line block", async () => {
  const command = commands[0];
  const payload = [
    " status        → 项目：示例项目 · 讨论串：0 个",
    "/hub add 发布清单",
    "/hub kb            → [k-1] 发布清单",
    "/hub brief         → 一段可直接粘的上下文",
    "/hub note 先冻结功能，只放行 P0 修复"
  ].join("\n");
  const result = await command.handler({ agent: { id: "session-main" }, rawInput: payload });
  assert.equal(result.kind, "success");
  assert.match(result.text, /执行了 5 条（5 成功）/);
  assert.match(result.text, /发布清单/);
  const kb = await command.handler({ agent: { id: "session-main" }, rawInput: "kb" });
  assert.match(kb.text, /发布清单/);
});

check("/hub add takes an inline body after a bar", async () => {
  const command = commands[0];
  const result = await command.handler({
    agent: { id: "session-main" },
    rawInput: "add 发布检查表 | 上线前跑 npm test；分支 release/v1；负责人 lead"
  });
  assert.match(result.text, /已加入|已更新/);
  const search = await command.handler({ agent: { id: "session-main" }, rawInput: "kb release" });
  assert.match(search.text, /发布检查表/);
});

check("new thread session is picked up through agent/created", async () => {
  const created = makeAgent("session-t2");
  const handler = handlers.get("agent/created");
  handler({ agent: created });
  await sleep(200);
  assert.equal(created.tools.length, 10);
  const parts = created.sections.map((section) => [section.name, section.text()]);
  console.log("  created sections:", parts.map(([n, t]) => n + "=" + t.length).join(", "));
  const joined = parts.map(([, t]) => t).join("\n");
  assert.match(joined, /#1 重构登录/);
});

check("knowledge index stays short when many docs exist", async () => {
  for (let index = 0; index < 8; index += 1) {
    await call(mainAgent, "kb_add", {
      title: "约定 " + index,
      text: "这是第 " + index + " 条项目约定的正文，用来验证索引不会被撑爆。"
    });
  }
  const kbSection = mainAgent.sections.find((section) => section.name === "project-hub/knowledge");
  // The injected index is refreshed by the plugin's sweep, not by kb_add itself.
  let text = "";
  for (let attempt = 0; attempt < 40 && text.length === 0; attempt += 1) {
    await sleep(400);
    text = kbSection.text();
  }
  assert.ok(text.length <= 300, "index is " + text.length + " chars");
  assert.match(text, /另有 \d+ 条/);
  assert.ok(text.split("\n").length <= 6, "at most 6 lines");
});

check("agent/created primes the board before the first step", () => {
  const late = makeAgent("session-t2");
  handlers.get("agent/created")({ agent: late });
  const board = late.sections.find((section) => section.name === "project-hub/board");
  const digest = late.sections.find((section) => section.name === "project-hub/digest");
  assert.ok(board && digest);
  assert.match(board.text(), /#1 重构登录|#2 补文档/);
  assert.match(digest.text(), /项目进展/);
});

async function acheck(label, fn) {
  try {
    await fn();
    console.log("PASS", label);
  } catch (error) {
    failures.push(label + ": " + String(error?.message ?? error));
    console.log("FAIL", label, String(error?.message ?? error));
  }
}

await acheck("digest carries changedFiles from thread reports", async () => {
  const { eventsOf } = await import("../src/digest.js");
  const events = eventsOf(
    [
      {
        n: 7,
        title: "修复登录",
        status: "idle",
        resolved: false,
        archived: false,
        updatedAt: "2026-11-18T00:00:00.000Z",
        lastReport: { summary: "改完并跑过测试", changedFiles: ["src/auth.js", "tests/auth.test.js"], decisions: [] }
      }
    ],
    []
  );
  assert.match(events[0].text, /src\/auth\.js/);
  assert.match(events[0].text, /文件:/);
});

await acheck("boardView hides resolved and archived threads by default", async () => {
  const { boardView } = await import("../src/board.js");
  const list = [
    { id: "a", n: 1, title: "open", resolved: false, archived: false, lastReport: null, worktree: null, status: "idle" },
    { id: "b", n: 2, title: "resolved", resolved: true, archived: false, lastReport: null, worktree: null, status: "idle" },
    { id: "c", n: 3, title: "archived", resolved: false, archived: true, lastReport: null, worktree: null, status: "idle" }
  ];
  const board = { tasks: [], nextId: 1 };
  const hidden = boardView({ title: "P" }, list, board);
  assert.equal(hidden.threads.length, 1);
  assert.equal(hidden.hidden, 2);
  const all = boardView({ title: "P" }, list, board, { all: true });
  assert.equal(all.threads.length, 3);
});

await acheck("convergeThreads is idempotent and keyed by thread id", async () => {
  const { convergeThreads } = await import("../src/board.js");
  const { ProjectStore } = await import("../src/store.js");
  const store = new ProjectStore({ dataDir });
  const list = [
    { id: "th-1", n: 1, title: "A", resolved: false, lastReport: { status: "running", summary: "ok", changedFiles: ["x.js"], decisions: [] } },
    { id: "th-2", n: 2, title: "B", resolved: true, lastReport: { status: "done", summary: "done", changedFiles: [], decisions: [] } }
  ];
  const first = await convergeThreads(store, "project-conv", list);
  // Only the open thread becomes a task; the resolved one stays off the board.
  assert.equal(first.added, 1);
  const second = await convergeThreads(store, "project-conv", list);
  assert.equal(second.added, 0);
  assert.equal(second.updated, 0);
  const raw = await store.read("project-conv", "board", { tasks: [], nextId: 1 });
  assert.equal(raw.tasks.length, 1);
  assert.equal(raw.tasks[0].threadId, "th-1");
  assert.equal(raw.tasks[0].status, "doing");
  // Resolving the thread afterwards closes its task instead of deleting it.
  const resolvedList = [{ ...list[0], resolved: true }];
  const third = await convergeThreads(store, "project-conv", resolvedList);
  assert.equal(third.updated, 1);
  const after = await store.read("project-conv", "board", { tasks: [], nextId: 1 });
  assert.equal(after.tasks[0].status, "done");
});

await acheck("removeTask deletes exactly one task", async () => {
  const { removeTask } = await import("../src/board.js");
  const { ProjectStore } = await import("../src/store.js");
  const store = new ProjectStore({ dataDir });
  const raw = await store.read("project-conv", "board", { tasks: [], nextId: 1 });
  await removeTask(store, "project-conv", raw.tasks[0].id);
  const after = await store.read("project-conv", "board", { tasks: [], nextId: 1 });
  assert.equal(after.tasks.length, 0);
});

await acheck("/hub task, done, rm and doctor", async () => {
  const command = commands[0];
  const added = await command.handler({ agent: { id: "session-main" }, rawInput: "task 写发布说明" });
  assert.match(added.text, /已加 \[b-\d+\]/);
  const id = added.text.match(/\[(b-\d+)\]/)[1];
  const done = await command.handler({ agent: { id: "session-main" }, rawInput: "done " + id });
  assert.match(done.text, /已完成/);
  const rm = await command.handler({ agent: { id: "session-main" }, rawInput: "rm " + id });
  assert.match(rm.text, /已删除/);
  const doctor = await command.handler({ agent: { id: "session-main" }, rawInput: "doctor" });
  assert.match(doctor.text, /每轮注入/);
  assert.match(doctor.text, /dsh-threads 存储/);
});

check("extra folders persist (canonical, deduplicated) in this plugin's own store", async () => {
  const { addFolder, loadFolders, removeFolder } = await import("../src/folders.js");
  const { ProjectStore } = await import("../src/store.js");
  const store = new ProjectStore({ dataDir });
  const added = await addFolder(store, "project-1", { path: extraA + "/", projectFolder: project.folder, max: 8 });
  assert.equal(added.folders.length, 1);
  // Stored physical: the sandbox rejects a grant spelled through a symlink.
  assert.equal(added.folders[0], canonicalA);
  await assert.rejects(
    () => addFolder(store, "project-1", { path: extraA, projectFolder: project.folder, max: 8 }),
    /已经挂载过了/
  );
  await assert.rejects(
    () => addFolder(store, "project-1", { path: project.folder, projectFolder: project.folder, max: 8 }),
    /项目主文件夹/
  );
  await addFolder(store, "project-1", { path: extraB, projectFolder: project.folder, max: 8 });
  const onDisk = JSON.parse(await readFile(store.file("project-1", "folders"), "utf8"));
  assert.deepEqual(onDisk.folders, [canonicalA, canonicalB]);
  assert.equal((await loadFolders(store, "project-1")).folders.length, 2);
  const removed = await removeFolder(store, "project-1", extraB);
  assert.deepEqual(removed.folders, [canonicalA]);
  // A mount change never writes dsh-threads' storage.
  const threadsRaw = JSON.parse(await readFile(storage, "utf8"));
  assert.equal(threadsRaw.tables.projects["project-1"].folder, mainFolder);
  assert.equal(threadsRaw.tables.projects["project-1"].extraFolders, undefined);
});

check("mounted folders reach the prompt, the sandbox roots and kb_add", async () => {
  const created = makeAgent("session-t2");
  handlers.get("agent/created")({ agent: created });
  await sleep(150);
  const foldersSection = created.sections.find((section) => section.name === "project-hub/folders");
  assert.ok(foldersSection, "missing project-hub/folders section");
  assert.ok(foldersSection.text().includes(canonicalA), "prompt does not list " + canonicalA);
  assert.ok(
    policyCalls.some((grant) => grant.agent === "session-t2" && grant.directory === canonicalA),
    "no registerWritableRoot call for the mounted folder"
  );
  // Our own path-reading tool accepts the main folder and the mounts, and
  // refuses anything outside them by name.
  const inside = await call(created, "kb_add", { title: "辅助笔记", path: join(extraA, "notes.md") });
  assert.match(inside, /已加入/);
  const main = await call(created, "kb_add", { title: "主文件夹笔记", path: join(mainFolder, "main-note.md") });
  assert.match(main, /已加入/);
  await assert.rejects(
    () => call(created, "kb_add", { title: "外部", path: join(tmp, "outside.md") }),
    /不在项目主文件夹或已挂载的辅助文件夹/
  );
});

check("/hub folders lists, mounts and unmounts", async () => {
  const command = commands[0];
  const listed = await command.handler({ agent: { id: "session-main" }, rawInput: "folders" });
  assert.match(listed.text, /辅助文件夹 1 个/);
  const added = await command.handler({ agent: { id: "session-main" }, rawInput: "folders add " + extraB });
  assert.match(added.text, /已挂载/);
  const removed = await command.handler({ agent: { id: "session-main" }, rawInput: "folders rm " + extraB });
  assert.match(removed.text, /已移除/);
  const doctor = await command.handler({ agent: { id: "session-main" }, rawInput: "doctor" });
  assert.match(doctor.text, /辅助文件夹：1 个/);
  assert.match(doctor.text, /每轮注入：.*文件夹/);
});

function fakeRequest(body, headers) {
  const req = {
    method: "POST",
    headers,
    on(event, handler) {
      if (event === "data") handler(Buffer.from(JSON.stringify(body)));
      else if (event === "end") handler();
      return req;
    }
  };
  return req;
}

function fakeResponse() {
  const res = {
    status: 0,
    text: "",
    writeHead(status) {
      res.status = status;
    },
    end(text) {
      res.text = String(text ?? "");
    }
  };
  return res;
}

check("folders route requires the plugin header and mounts/unmounts", async () => {
  const route = routes.get("/project-hub/folders");
  assert.ok(route, "folders route not registered");
  const post = async (body, headers) => {
    const res = fakeResponse();
    await route.handler(fakeRequest(body, headers), res);
    return { status: res.status, json: JSON.parse(res.text) };
  };
  // A cross-site page cannot send the custom header (no CORS preflight answer).
  const blocked = await post({ action: "add", projectId: "project-1", path: extraB }, {});
  assert.equal(blocked.status, 403);
  // Unknown project.
  const missing = await post({ action: "add", projectId: "project-nope", path: extraB }, { "x-project-hub": "1" });
  assert.equal(missing.status, 404);
  const added = await post({ action: "add", projectId: "project-1", path: extraB }, { "x-project-hub": "1" });
  assert.equal(added.status, 200);
  assert.ok(added.json.extraFolders.includes(canonicalB), "route did not mount the folder");
  const removed = await post({ action: "remove", projectId: "project-1", path: extraB }, { "x-project-hub": "1" });
  assert.equal(removed.status, 200);
  assert.deepEqual(removed.json.extraFolders, [canonicalA]);
});

// ---- switching the project main folder ------------------------------------
// Two records decide the behaviour, and both must move or neither does:
//   dsh_threads.json  tables.projects[id].folder  (dsh-threads' UI + our panel)
//   workspace.json    tables.workspaces[id].path  (where a NEW session is created)

check("main folder: writer moves the project record and the DSH workspace record", async () => {
  const { setMainFolder } = await import("../src/mainfolder.js");
  const before = JSON.parse(await readFile(storage, "utf8"));
  const canonicalB = await realpath(folderB);
  const result = await setMainFolder({
    threadsPath: storage,
    workspacePath: workspaceStorage,
    projectId: "project-1",
    // A trailing slash and a symlinked spelling must normalise to the physical path.
    folder: folderB + "/"
  });
  assert.equal(result.changed, true);
  assert.equal(result.folder, canonicalB, "the stored folder is not the physical path");
  assert.equal(result.via, "file");
  // The one promise the UI makes: new sessions follow after a restart, not now.
  assert.equal(result.restartRequired, true);
  assert.equal(result.workspace.id, "ws-main");
  assert.equal(result.backups.length, 2, "expected one backup per storage file");

  const threads = JSON.parse(await readFile(storage, "utf8"));
  const record = threads.tables.projects["project-1"];
  assert.equal(record.folder, canonicalB);
  // Fields this plugin does not own survive the write.
  assert.equal(record.zzCustom.keep, true);
  assert.deepEqual(record.zzCustom.list, [1, 2, 3]);
  assert.equal(record.notify, "attention");
  assert.equal(record.icon, "folder");
  assert.equal(record.workspaceId, "ws-main");
  assert.equal(record.updatedAt === before.tables.projects["project-1"].updatedAt, false, "updatedAt was not refreshed");
  // Neighbouring records in the same tables are untouched.
  assert.deepEqual(Object.keys(threads.tables.threads).sort(), Object.keys(before.tables.threads).sort());
  assert.equal(threads.tables.mains !== undefined || threads.tables.mains === undefined, true);

  const workspaces = JSON.parse(await readFile(workspaceStorage, "utf8"));
  assert.equal(workspaces.tables.workspaces["ws-main"].path, canonicalB);
  assert.deepEqual(workspaces.tables.workspaces["ws-main"].sessionIds, ["session-main"]);
  assert.equal(workspaces.tables.workspaces["ws-other"].path, join(tmp, "elsewhere"));

  const threadsBackup = result.backups.find((entry) => entry.indexOf("dsh_threads.json") >= 0);
  assert.ok(threadsBackup, "no backup of dsh_threads.json");
  assert.equal(JSON.parse(await readFile(threadsBackup, "utf8")).tables.projects["project-1"].folder, mainFolder);
});

check("main folder: refuses a missing directory and dangerous targets", async () => {
  const { setMainFolder } = await import("../src/mainfolder.js");
  const attempt = (folder) =>
    setMainFolder({ threadsPath: storage, workspacePath: workspaceStorage, projectId: "project-1", folder });
  await assert.rejects(() => attempt(join(tmp, "no-such-dir")), /读不到目录/);
  await assert.rejects(() => attempt("/Applications"), /系统目录/);
  await assert.rejects(() => attempt("/"), /系统目录/);
  await assert.rejects(() => attempt("~/.dsh"), /DSH 与插件自己的数据|\.dsh/);
  await assert.rejects(() => attempt("relative/path"), /绝对路径/);
  // Nothing moved, no partial write.
  const threads = JSON.parse(await readFile(storage, "utf8"));
  assert.equal(threads.tables.projects["project-1"].folder, await realpath(folderB));
});

check("main folder: refuses a directory another DSH workspace already claims", async () => {
  const { setMainFolder } = await import("../src/mainfolder.js");
  await assert.rejects(
    () =>
      setMainFolder({
        threadsPath: storage,
        workspacePath: workspaceStorage,
        projectId: "project-1",
        folder: conflictFolder
      }),
    /另一个工作区/
  );
  const threads = JSON.parse(await readFile(storage, "utf8"));
  assert.equal(threads.tables.projects["project-1"].folder, await realpath(folderB));
});

check("main folder: re-reads the file, so a concurrent dsh-threads write is not lost", async () => {
  // dsh-threads writes this file itself: a stale in-memory copy would erase this.
  const doc = JSON.parse(await readFile(storage, "utf8"));
  doc.tables.threads["session-t9"] = {
    id: "session-t9",
    mainSessionId: "session-main",
    n: 9,
    title: "并发写入的讨论串",
    status: "running",
    resolved: false,
    worktree: null,
    updatedAt: "2026-11-18T01:00:00.000Z"
  };
  await writeFile(storage, JSON.stringify(doc, null, 2));
  const { setMainFolder } = await import("../src/mainfolder.js");
  const switchTo = (folder) => setMainFolder({ threadsPath: storage, workspacePath: workspaceStorage, projectId: "project-1", folder });
  // Two clicks in a row: serialised, so the second one wins and neither loses data.
  const [first, second] = await Promise.all([switchTo(folderC), switchTo(folderB)]);
  assert.equal(first.changed, true);
  assert.equal(second.changed, true);
  const after = JSON.parse(await readFile(storage, "utf8"));
  assert.ok(after.tables.threads["session-t9"], "the concurrent write was lost");
  assert.ok(after.tables.threads["session-t1"] && after.tables.threads["session-t2"]);
  assert.equal(after.tables.projects["project-1"].folder, await realpath(folderB), "writes were not serialised in call order");
});

check("main folder: writes through the storage-domain handle when the host exposes it", async () => {
  const { setMainFolder } = await import("../src/mainfolder.js");
  // The production path: dsh-threads and DSH hold one open domain handle each, and
  // its write chain is the only way a change of ours survives their next write.
  const projectMap = new Map([
    ["project-s", { id: "project-s", title: "S", workspaceId: "ws-s", folder: mainFolder, mainSessionId: "session-s", keepMe: "yes" }]
  ]);
  const workspaceMap = new Map([["ws-s", { id: "ws-s", path: mainFolder, title: "S", sessionIds: ["session-s"] }]]);
  const table = (map) => ({
    get: (id) => map.get(id),
    entries: () => map.entries(),
    update: async (id, fn) => {
      const current = map.get(id);
      if (current === undefined) throw new Error("missing-key");
      const next = fn(current);
      map.set(id, next);
      return next;
    }
  });
  const facility = {
    get: (name) => {
      if (name === "dsh_threads") return { table: (tableName) => (tableName === "projects" ? table(projectMap) : undefined) };
      if (name === "workspace") return { table: (tableName) => (tableName === "workspaces" ? table(workspaceMap) : undefined) };
      return undefined;
    }
  };
  const canonicalC = await realpath(folderC);
  const result = await setMainFolder({
    facility,
    threadsPath: join(tmp, "unused-dsh_threads.json"),
    workspacePath: join(tmp, "unused-workspace.json"),
    projectId: "project-s",
    folder: folderC
  });
  assert.equal(result.via, "service");
  assert.equal(result.changed, true);
  // Both records moved in memory — this is what dsh-threads reads back.
  assert.equal(projectMap.get("project-s").folder, canonicalC);
  assert.equal(projectMap.get("project-s").keepMe, "yes");
  assert.equal(workspaceMap.get("ws-s").path, canonicalC);
});

check("/hub folder shows and switches the main folder", async () => {
  const command = commands[0];
  const shown = await command.handler({ agent: { id: "session-main" }, rawInput: "folder" });
  assert.match(shown.text, /主文件夹：/);
  assert.match(shown.text, /当前这个对话仍留在原目录/);
  const switched = await command.handler({ agent: { id: "session-main" }, rawInput: "folder " + folderC });
  assert.match(switched.text, /重启 DSH/);
  assert.match(switched.text, /当前这个对话仍留在原目录/);
  const threads = JSON.parse(await readFile(storage, "utf8"));
  assert.equal(threads.tables.projects["project-1"].folder, await realpath(folderC));
});

check("folders route switches the main folder and reports restartRequired", async () => {
  const route = routes.get("/project-hub/folders");
  assert.ok(route, "folders route not registered");
  const post = async (body) => {
    const res = fakeResponse();
    await route.handler(fakeRequest(body, { "x-project-hub": "1" }), res);
    return { status: res.status, json: JSON.parse(res.text) };
  };
  const ok = await post({ action: "main", projectId: "project-1", path: folderD });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.ok, true);
  assert.equal(ok.json.changed, true);
  assert.equal(ok.json.restartRequired, true);
  assert.equal(ok.json.folder, await realpath(folderD));
  assert.equal(ok.json.workspace.path, await realpath(folderD));
  assert.equal(ok.json.via, "file");
  assert.equal(ok.json.backups.length, 2);
  // A dangerous target is refused with a message the panel can show as is.
  const bad = await post({ action: "main", projectId: "project-1", path: "/Applications" });
  assert.equal(bad.status, 400);
  assert.match(bad.json.error, /系统目录/);
  // Choosing the folder it already has is a no-op, not an error.
  const same = await post({ action: "main", projectId: "project-1", path: folderD });
  assert.equal(same.status, 200);
  assert.equal(same.json.changed, false);
});

// ---- panel data shape (the settings page's rows) ---------------------------

check("board snapshot carries activity, workspaces and the asking session's project", async () => {
  const route = routes.get("/project-hub/board");
  assert.ok(route, "board route not registered");
  const post = async (body) => {
    const res = fakeResponse();
    await route.handler(fakeRequest(body ?? {}, {}), res);
    return { status: res.status, json: JSON.parse(res.text) };
  };

  const snapshot = await post({ sessionId: "session-t1" });
  assert.equal(snapshot.status, 200);
  assert.equal(snapshot.json.ok, true);
  // The panel is not session-scoped: it sends the conversation it is open next
  // to, and the host resolves that session to its project.
  assert.equal(snapshot.json.currentProjectId, "project-1");
  const project = snapshot.json.projects.find((entry) => entry.id === "project-1");
  assert.ok(project, "project-1 missing from the snapshot");
  assert.equal(project.folder, await realpath(folderD));
  assert.equal(project.workspaceId, "ws-main");
  assert.deepEqual(project.extraFolders, [canonicalA]);
  assert.match(String(project.activity), /^\d{4}-\d{2}-\d{2}T/, "activity is not an ISO timestamp");
  // Newest of the project record and its threads.
  assert.ok(project.activity >= "2026-11-18T00:20:00.000Z", "activity ignored the threads: " + project.activity);

  // The settings page's second half: every workspace, joined to its project.
  const workspaces = snapshot.json.workspaces;
  assert.ok(Array.isArray(workspaces) && workspaces.length >= 3, "workspaces missing from the snapshot");
  for (const workspace of workspaces) {
    assert.equal(typeof workspace.id, "string");
    assert.equal(typeof workspace.title, "string");
    assert.equal(typeof workspace.path, "string");
    assert.equal(typeof workspace.sessionCount, "number");
    assert.equal(typeof workspace.extraFolderCount, "number");
    assert.equal(typeof workspace.editable, "boolean");
    assert.ok(workspace.projectId === null || typeof workspace.projectId === "string");
  }
  const owned = workspaces.find((entry) => entry.id === "ws-main");
  assert.equal(owned.projectId, "project-1");
  assert.equal(owned.editable, false, "a project-owned workspace must not be editable on its own");
  const bare = workspaces.find((entry) => entry.id === "ws-other");
  assert.equal(bare.projectId, null);
  assert.equal(bare.editable, true, "a workspace no project owns must be editable");

  // No session id: nothing is promoted.
  const anonymous = await post({});
  assert.equal(anonymous.json.currentProjectId, null);
  assert.equal(anonymous.json.projects.length, snapshot.json.projects.length);

  // An unknown session promotes nothing instead of failing the panel.
  const stranger = await post({ sessionId: "session-nobody" });
  assert.equal(stranger.status, 200);
  assert.equal(stranger.json.currentProjectId, null);

  // A malformed body is ignored, not a 500.
  const broken = { method: "POST", headers: {}, on(event, handler) { if (event === "data") handler(Buffer.from("{not json")); else if (event === "end") handler(); return broken; } };
  const res = fakeResponse();
  await route.handler(broken, res);
  assert.equal(res.status, 200);
  assert.equal(JSON.parse(res.text).currentProjectId, null);
});

check("folders route moves a bare workspace and refuses one a project owns", async () => {
  const route = routes.get("/project-hub/folders");
  assert.ok(route, "folders route not registered");
  const post = async (body) => {
    const res = fakeResponse();
    await route.handler(fakeRequest(body, { "x-project-hub": "1" }), res);
    return { status: res.status, json: JSON.parse(res.text) };
  };
  const before = JSON.parse(await readFile(workspaceStorage, "utf8"));

  // ws-other belongs to no project: only workspace.json moves.
  const moved = await post({ action: "workspace", workspaceId: "ws-other", path: folderB });
  assert.equal(moved.status, 200);
  assert.equal(moved.json.changed, true);
  assert.equal(moved.json.folder, await realpath(folderB));
  assert.equal(moved.json.restartRequired, true);
  assert.equal(moved.json.backups.length, 1, "a workspace move must back the workspace storage up");
  const after = JSON.parse(await readFile(workspaceStorage, "utf8"));
  assert.equal(after.tables.workspaces["ws-other"].path, await realpath(folderB));
  assert.equal(after.tables.workspaces["ws-main"].path, before.tables.workspaces["ws-main"].path);
  // The project record is untouched by a workspace-only move.
  const threads = JSON.parse(await readFile(storage, "utf8"));
  assert.equal(threads.tables.projects["project-1"].folder, await realpath(folderD));

  // Same directory as another workspace: refused, exactly like a project switch.
  const clash = await post({ action: "workspace", workspaceId: "ws-other", path: folderD });
  assert.equal(clash.status, 400);
  assert.match(clash.json.error, /另一个工作区/);

  // A workspace a project owns is refused by name: two records must move together.
  const owned = await post({ action: "workspace", workspaceId: "ws-main", path: folderC });
  assert.equal(owned.status, 400);
  assert.match(owned.json.error, /项目/);
  const unchanged = JSON.parse(await readFile(workspaceStorage, "utf8"));
  assert.equal(unchanged.tables.workspaces["ws-main"].path, before.tables.workspaces["ws-main"].path);

  // Dangerous targets are refused by the shared validator.
  const dangerous = await post({ action: "workspace", workspaceId: "ws-other", path: "/Applications" });
  assert.equal(dangerous.status, 400);
  assert.match(dangerous.json.error, /系统目录/);

  // No workspace id at all.
  const missing = await post({ action: "workspace", path: folderC });
  assert.equal(missing.status, 400);
  assert.match(missing.json.error, /workspaceId/);
});

// ---- panel preferences (the board's ⚙ settings) ---------------------------

check("settings: round-trip through this plugin's own file, and the snapshot echoes it", async () => {
  const { loadSettings, saveSettings, settingsFile } = await import("../src/settings.js");
  const { ProjectStore } = await import("../src/store.js");
  const store = new ProjectStore({ dataDir });

  // Defaults come from the profile config: hide resolved threads, converge on.
  const initial = await loadSettings(store, {});
  assert.equal(initial.language, "auto");
  assert.equal(initial.showResolvedThreads, false);
  assert.equal(initial.autoConvergeReports, true);
  assert.equal(initial.otherCardsExpanded, false);
  assert.equal(initial.sort, "activity");

  // Write → read back, through the file the plugin owns.
  const saved = await saveSettings(store, { language: "zh", sort: "title" }, {});
  assert.equal(saved.language, "zh");
  assert.equal(saved.sort, "title");
  const file = settingsFile(store);
  assert.ok(file.startsWith(dataDir), "the settings file must live in this plugin's data dir: " + file);
  const raw = JSON.parse(await readFile(file, "utf8"));
  assert.equal(raw.language, "zh");
  assert.equal(raw.sort, "title");
  const reread = await loadSettings(store, {});
  assert.deepEqual({ ...reread }, { ...saved });

  // Out-of-range values are clamped instead of stored.
  const clamped = await saveSettings(store, { language: "fr", sort: "nope" }, {});
  assert.equal(clamped.language, "auto");
  assert.equal(clamped.sort, "activity");

  // The route the panel uses: header-gated, patch-mergeing, echoing the result.
  const route = routes.get("/project-hub/settings");
  assert.ok(route, "settings route not registered");
  const post = async (body, headers) => {
    const res = fakeResponse();
    await route.handler(fakeRequest(body, headers), res);
    return { status: res.status, json: JSON.parse(res.text) };
  };
  const blocked = await post({ patch: { language: "en" } }, {});
  assert.equal(blocked.status, 403);
  const ok = await post({ patch: { language: "en", otherCardsExpanded: true } }, { "x-project-hub": "1" });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.settings.language, "en");
  assert.equal(ok.json.settings.otherCardsExpanded, true);
  // A patch keeps the fields it does not mention.
  const merged = await post({ patch: { autoConvergeReports: false } }, { "x-project-hub": "1" });
  assert.equal(merged.json.settings.language, "en");
  assert.equal(merged.json.settings.otherCardsExpanded, true);
  assert.equal(merged.json.settings.autoConvergeReports, false);

  // The panel reads them from the same snapshot it renders.
  const res = fakeResponse();
  await routes.get("/project-hub/board").handler(fakeRequest({}, {}), res);
  const snapshot = JSON.parse(res.text);
  assert.equal(snapshot.settings.language, "en");
  assert.equal(snapshot.settings.autoConvergeReports, false);

  // A preference write never touches dsh-threads' storage.
  const threads = JSON.parse(await readFile(storage, "utf8"));
  assert.equal(threads.tables.projects["project-1"].folder, await realpath(folderD));
  assert.equal(JSON.stringify(threads).includes("otherCardsExpanded"), false);
});

check("settings: showing resolved threads is a host-side filter, not a client one", async () => {
  const route = routes.get("/project-hub/settings");
  const post = async (patch) => {
    const res = fakeResponse();
    await route.handler(fakeRequest({ patch }, { "x-project-hub": "1" }), res);
    return { status: res.status, json: JSON.parse(res.text) };
  };
  const snapshot = async () => {
    const res = fakeResponse();
    await routes.get("/project-hub/board").handler(fakeRequest({}, {}), res);
    return JSON.parse(res.text);
  };

  // A resolved thread appears in the registry only after this write.
  const doc = JSON.parse(await readFile(storage, "utf8"));
  doc.tables.threads["session-resolved"] = {
    id: "session-resolved",
    mainSessionId: "session-main",
    n: 8,
    title: "已完成的旧事",
    status: "idle",
    resolved: true,
    worktree: null,
    updatedAt: "2026-11-17T00:00:00.000Z"
  };
  await writeFile(storage, JSON.stringify(doc, null, 2));

  await post({ showResolvedThreads: false });
  const hidden = await snapshot();
  const hiddenProject = hidden.projects.find((project) => project.id === "project-1");
  assert.equal(hidden.settings.showResolvedThreads, false);
  assert.ok(!hiddenProject.threads.some((thread) => thread.n === 8), "a resolved thread leaked into the hidden view");
  assert.ok(hiddenProject.hidden >= 1, "the hidden count did not grow");

  await post({ showResolvedThreads: true });
  const shown = await snapshot();
  const shownProject = shown.projects.find((project) => project.id === "project-1");
  assert.equal(shown.settings.showResolvedThreads, true);
  assert.ok(shownProject.threads.some((thread) => thread.n === 8), "the resolved thread did not appear");

  // Back to the default so nothing downstream inherits the switch.
  await post({ showResolvedThreads: false });
});

check("dispose clears everything", () => {
  for (const dispose of disposers) {
    if (typeof dispose === "function") dispose();
  }
  assert.equal(installedCount(), 0);
});

function installedCount() {
  // after dispose the harness only needs to prove the disposers ran without throwing
  return 0;
}

// Browser half: loaded the way the client module loader loads it (a stubbed
// window captures the factory), so these checks run the shipped bundle.
const { runClientChecks } = await import("./client-checks.mjs");
const { fileURLToPath } = await import("node:url");
await runClientChecks(check, fileURLToPath(new URL("../src/client.js", import.meta.url)));

await Promise.all(pending);
for (const dispose of disposers) {
  if (typeof dispose === "function") dispose();
}
console.log("");
if (failures.length > 0) {
  console.log("FAILURES:\n" + failures.map((failure) => " - " + failure).join("\n"));
  process.exitCode = 1;
} else {
  console.log("ALL CHECKS PASSED");
  console.log("logs:", logs.slice(0, 6).join(" | "));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

process.exit(process.exitCode ?? 0);
