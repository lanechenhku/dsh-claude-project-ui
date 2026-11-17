import { existsSync, statSync } from "node:fs";
import { addNote, digestText, eventsOf, loadNotes } from "./digest.js";
import { addDoc, kbIndexText, loadKb, searchKb } from "./kb.js";
import { boardContextText, boardText, boardView, convergeThreads, loadBoard, addTask, removeTask, updateTask } from "./board.js";
import { composeBrief } from "./tools.js";
import { oneLine } from "./util.js";

const MAX_OPS = 12;

const USAGE = [
  "用法（一条一行，可一次粘多行）：",
  "  /hub status            我在哪个项目、有多少知识/任务",
  "  /hub board [--all]     看板：讨论串状态 + 任务（默认隐藏已解决/已归档的讨论串）",
  "  /hub task <标题>        加一条手动任务",
  "  /hub done <b-N>         把任务标记为完成",
  "  /hub rm <b-N>           删除任务",
  "  /hub doctor             自检：数据目录、讨论串存储、注入预算",
  "  /hub kb [关键词]        知识库列表，或直接检索",
  "  /hub brief             生成可直接粘进 thread_open.task 的项目上下文",
  "  /hub note <文本>        记一条项目级上下文（所有会话可见）",
  "  /hub add <标题> | <正文>  加一篇知识库文档（正文可省略，之后用 kb_add 补）"
].join("\n");

/**
 * Turn one raw command payload into a list of sub-operations.
 *
 * The payload is plain text, so a pasted block like
 *
 *   /hub status  → 0 讨论串
 *   /hub add 发布清单
 *
 * must run every line: dropping everything after the first verb is exactly the
 * bug users see as "nothing happened". Trailing "→ …" annotations are comments.
 */
export function splitOperations(rawInput) {
  const ops = [];
  for (const line of String(rawInput ?? "").split(/\r?\n/)) {
    const cleaned = line
      .replace(/^\s*\/hub\b\s*/i, "")
      .replace(/\s*→.*$/, "")
      .trim();
    if (cleaned.length > 0) ops.push(cleaned);
  }
  return ops.slice(0, MAX_OPS);
}

export function registerHubCommand(ctx, runtime, commandDefinitionId) {
  ctx.commands.register({
    definitionId: commandDefinitionId("dsh-project-hub"),
    name: "hub",
    description: "项目共享知识库、跨讨论串看板与上下文简报：/hub status|board|task|done|rm|kb|brief|note|add|doctor",
    input: { hint: "status | board [--all] | task <title> | done <id> | rm <id> | kb [query] | brief | note <text> | add <title> | doctor" },
    handler: async ({ agent, rawInput }) => {
      const role = await runtime.registry.roleOf(agent.id).catch(() => null);
      if (role === null || role.project === null) {
        return { kind: "error", text: "这个会话不属于任何 dsh-threads 项目；先把它建成项目的主对话，或在讨论串里使用。" };
      }
      const ops = splitOperations(rawInput);
      if (ops.length === 0) return { kind: "success", text: USAGE };
      if (ops.length === 1) return run(runtime, role, ops[0]);

      const parts = [];
      let failed = 0;
      for (const op of ops) {
        const result = await run(runtime, role, op).catch((error) => ({ kind: "error", text: String(error?.message ?? error) }));
        if (result.kind === "error") failed += 1;
        parts.push((parts.length === 0 ? "" : "\n") + "▸ /hub " + op + "\n" + result.text);
      }
      return {
        kind: failed > 0 ? "error" : "success",
        text: `执行了 ${ops.length} 条（${ops.length - failed} 成功${failed > 0 ? "，" + failed + " 失败" : ""}）` + parts.join("\n")
      };
    }
  });
}

async function run(runtime, role, operation) {
  const project = role.project;
  const [verb, ...rest] = operation.split(/\s+/);
  const tail = rest.join(" ").trim();
  try {
    switch (verb.toLowerCase()) {
      case "status":
        return await status(runtime, role);
      case "board": {
        const all = /(^|\s)--all(\s|$)/.test(tail);
        const [threads, board] = await Promise.all([
          runtime.registry.threadsOf(project.id),
          loadBoard(runtime.store, project.id)
        ]);
        return {
          kind: "success",
          text: `项目：${project.title}\n` + boardText(boardView(project, threads, board, { all }))
        };
      }
      case "task": {
        if (tail.length === 0) return { kind: "error", text: "用法：/hub task <标题>" };
        const task = await addTask(runtime.store, project.id, { subject: tail });
        return { kind: "success", text: `已加 [${task.id}] ${task.subject} — ${task.status}` };
      }
      case "done": {
        if (!/^b-\d+$/.test(tail)) return { kind: "error", text: "用法：/hub done <b-N>" };
        const task = await updateTask(runtime.store, project.id, { task_id: tail, status: "done" });
        return { kind: "success", text: `已完成 [${task.id}] ${task.subject}` };
      }
      case "rm": {
        if (!/^b-\d+$/.test(tail)) return { kind: "error", text: "用法：/hub rm <b-N>" };
        await removeTask(runtime.store, project.id, tail);
        return { kind: "success", text: `已删除 [${tail}]` };
      }
      case "doctor":
        return { kind: "success", text: await doctor(runtime, role) };
      case "kb": {
        const kb = await loadKb(runtime.store, project.id);
        if (tail.length > 0) {
          const hits = searchKb(kb, tail, 5);
          if (hits.length === 0) return { kind: "success", text: "没有命中「" + oneLine(tail, 40) + "」" };
          return { kind: "success", text: hits.map((hit) => `\n[${hit.id}] ${hit.title}\n${hit.snippet}`).join("\n") };
        }
        if (kb.docs.length === 0) return { kind: "success", text: "知识库还是空的：用 kb_add 工具或 /hub add <标题> 开始。" };
        return {
          kind: "success",
          text: [`知识库 ${kb.docs.length} 篇`].concat(kb.docs.map((doc) => `- [${doc.id}] ${doc.title} · ${doc.text.length} 字`)).join("\n")
        };
      }
      case "brief":
        return { kind: "success", text: await composeBrief(runtime, project, role.kind) };
      case "note": {
        if (tail.length === 0) return { kind: "error", text: "用法：/hub note <文本>" };
        const note = await addNote(runtime.store, project.id, runtime.config, { text: tail }, "用户命令");
        return { kind: "success", text: `已记录 [${note.id}]：${note.text}` };
      }
      case "add": {
        if (tail.length === 0) return { kind: "error", text: "用法：/hub add <标题> | <正文>（正文可省略，之后用 kb_add 补）" };
        const bar = tail.indexOf("|");
        const title = (bar === -1 ? tail : tail.slice(0, bar)).trim();
        const body = bar === -1 ? "" : tail.slice(bar + 1).trim();
        if (title.length === 0) return { kind: "error", text: "用法：/hub add <标题> | <正文>" };
        const result = await addDoc(runtime.store, project.id, runtime.config, {
          title,
          text: body.length > 0 ? body : "（占位：用 kb_add 同名标题写入正文）"
        });
        return {
          kind: "success",
          text: `${result.replaced ? "已更新" : "已加入"} [${result.doc.id}] ${result.doc.title}（${result.doc.text.length} 字）`
        };
      }
      default:
        return { kind: "error", text: USAGE };
    }
  } catch (error) {
    return { kind: "error", text: `/hub ${verb} 失败：${String(error?.message ?? error)}` };
  }
}

async function status(runtime, role) {
  const project = role.project;
  const [threads, kb, board] = await Promise.all([
    runtime.registry.threadsOf(project.id),
    loadKb(runtime.store, project.id),
    loadBoard(runtime.store, project.id)
  ]);
  return {
    kind: "success",
    text: [
      `项目：${project.title}（${project.id}）`,
      `角色：${role.kind === "thread" ? "讨论串 #" + (role.thread?.n ?? "?") : "主对话"}`,
      `讨论串：${threads.length} 个 · 知识库：${kb.docs.length} 篇 / ${kb.docs.reduce((sum, doc) => sum + doc.text.length, 0)} 字 · 手动任务：${board.tasks.length} 条`,
      `数据目录：${runtime.store.root}`
    ].join("\n")
  };
}

/** `/hub doctor`: prove the pieces are wired without changing anything. */
async function doctor(runtime, role) {
  const project = role.project;
  const config = runtime.config;
  const mark = (value) => (value ? "✅" : "⚠️");
  const lines = [];

  lines.push(`项目：${project.title}（${project.id}）`);
  lines.push(`角色：${role.kind === "thread" ? "讨论串 #" + (role.thread?.n ?? "?") : "主对话"}`);

  const dataDir = runtime.store.root;
  lines.push(`数据目录：${dataDir} ${mark(existsSync(dataDir))}`);

  const storage = runtime.registry.path;
  let storageSize = 0;
  let storageOk = false;
  try {
    storageSize = statSync(storage).size;
    storageOk = storageSize > 0;
  } catch {
    storageOk = false;
  }
  lines.push(
    `dsh-threads 存储：${storage} ${mark(storageOk)}` + (storageOk ? ` (${(storageSize / 1024).toFixed(0)} KB)` : "（读不到）")
  );

  const [threads, kb, board, notes] = await Promise.all([
    runtime.registry.threadsOf(project.id),
    loadKb(runtime.store, project.id),
    loadBoard(runtime.store, project.id),
    loadNotes(runtime.store, project.id)
  ]);

  const open = threads.filter((thread) => thread.resolved !== true && thread.archived !== true).length;
  const auto = board.tasks.filter((task) => typeof task.threadId === "string").length;
  lines.push(`讨论串：${threads.length} 个（未解决 ${open}，已解决/归档 ${threads.length - open}）`);
  lines.push(`看板：手动 ${board.tasks.length - auto} 条 + 自动汇总 ${auto} 条`);

  const kbChars = kb.docs.reduce((sum, doc) => sum + doc.text.length, 0);
  const kbOk = kb.docs.length <= config.maxDocs && kbChars <= config.maxKnowledgeChars;
  lines.push(`知识库：${kb.docs.length}/${config.maxDocs} 篇 · ${kbChars}/${config.maxKnowledgeChars} 字 ${mark(kbOk)}`);

  const kbInject = kbIndexText(kb, config.knowledgeIndexMaxChars, config.kbIndexMaxDocs ?? 3).length;
  const boardInject = boardContextText(
    boardView(project, threads, board, { all: config.hideResolvedThreads !== true }),
    config.boardContextMaxChars
  ).length;
  const digestInject = digestText(eventsOf(threads, notes.notes), config.digestContextMaxChars).length;
  const total = kbInject + boardInject + digestInject;
  lines.push(
    `每轮注入：知识 ${kbInject} + 看板 ${boardInject} + 进展 ${digestInject} = ${total} 字符 ${mark(total <= 1800)}`
  );
  lines.push(
    `开关：hideResolvedThreads=${config.hideResolvedThreads} · autoConvergeReports=${config.autoConvergeReports} · 笔记 ${notes.notes.length}/${config.maxNotes}`
  );
  if (threads.length > open && config.hideResolvedThreads !== true) {
    lines.push("提示：hideResolvedThreads 关着，已解决/归档的讨论串也会出现在看板和注入里。");
  }
  return lines.join("\n");
}

/** Unused re-exports kept lexical for tests. */
export const internals = { addTask, convergeThreads, digestText, doctor, eventsOf, loadNotes, kbIndexText, removeTask, updateTask };
