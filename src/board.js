import { nowIso, oneLine } from "./util.js";
import { fit } from "./kb.js";
import { threadBranch, threadState } from "./project.js";

const FILE = "board";

export async function loadBoard(store, projectId) {
  const raw = await store.read(projectId, FILE, { tasks: [], nextId: 1 });
  const tasks = Array.isArray(raw.tasks) ? raw.tasks.filter(isTask) : [];
  const nextId = Number(raw.nextId) > 0 ? Number(raw.nextId) : tasks.length + 1;
  return { tasks, nextId };
}

export function loadBoardSync(store, projectId) {
  const raw = store.readSync(projectId, FILE, { tasks: [], nextId: 1 });
  const tasks = Array.isArray(raw.tasks) ? raw.tasks.filter(isTask) : [];
  const nextId = Number(raw.nextId) > 0 ? Number(raw.nextId) : tasks.length + 1;
  return { tasks, nextId };
}

function isTask(value) {
  return value !== null && typeof value === "object" && typeof value.id === "string" && typeof value.subject === "string";
}

const STATUSES = new Set(["pending", "doing", "blocked", "done"]);

async function addTaskInner(store, projectId, input) {
  const board = await loadBoard(store, projectId);
  const subject = oneLine(input.subject ?? "", 120);
  if (subject.length === 0) throw new Error("board_add 需要 subject");
  const status = STATUSES.has(String(input.status)) ? String(input.status) : "pending";
  const task = {
    id: "b-" + board.nextId,
    subject,
    status,
    owner: oneLine(input.owner ?? "", 60) || null,
    note: oneLine(input.note ?? "", 300) || null,
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  board.tasks.push(task);
  board.nextId += 1;
  await store.write(projectId, FILE, board);
  return task;
}

async function updateTaskInner(store, projectId, input) {
  const board = await loadBoard(store, projectId);
  const task = board.tasks.find((candidate) => candidate.id === input.task_id);
  if (task === undefined) throw new Error(`没有任务 ${input.task_id}`);
  if (input.subject !== undefined) {
    const subject = oneLine(input.subject, 120);
    if (subject.length === 0) throw new Error("subject 不能为空");
    task.subject = subject;
  }
  if (input.status !== undefined) {
    if (!STATUSES.has(String(input.status))) throw new Error(`status 只能是 ${[...STATUSES].join(" / ")}`);
    task.status = String(input.status);
  }
  if (input.owner !== undefined) task.owner = oneLine(input.owner, 60) || null;
  if (input.note !== undefined) task.note = oneLine(input.note, 300) || null;
  task.updatedAt = nowIso();
  await store.write(projectId, FILE, board);
  return task;
}

/** A thread still worth showing on the board: neither resolved nor archived. */
export function isOpenThread(thread) {
  return thread.resolved !== true && thread.archived !== true;
}

/** Merge the live thread view (owned by dsh-threads) with the manual tasks kept here. */
export function boardView(project, threads, board, options = {}) {
  const all = options.all === true;
  const visible = all ? threads : threads.filter(isOpenThread);
  return {
    project: project.title,
    all,
    hidden: threads.length - visible.length,
    threads: visible.map((thread) => ({
      n: thread.n,
      title: thread.title,
      state: threadState(thread),
      branch: threadBranch(thread),
      report: typeof thread.lastReport?.summary === "string" ? oneLine(thread.lastReport.summary, 80) : null
    })),
    tasks: board.tasks.map((task) => ({ id: task.id, subject: task.subject, status: task.status, owner: task.owner, note: task.note }))
  };
}

export function boardText(view) {
  const lines = [];
  if (view.threads.length > 0) {
    lines.push("讨论串：");
    for (const thread of view.threads) {
      const branch = thread.branch !== null ? ` · ${thread.branch}` : "";
      lines.push(`- #${thread.n} ${thread.title} — ${thread.state}${branch}`);
    }
  }
  if (view.tasks.length > 0) {
    lines.push("任务：");
    for (const task of view.tasks) {
      const owner = task.owner !== null ? ` @${task.owner}` : "";
      const note = task.note !== null ? ` — ${task.note}` : "";
      lines.push(`- [${task.id}] ${task.subject} — ${task.status}${owner}${note}`);
    }
  }
  if (view.hidden > 0) lines.push(`（另有 ${view.hidden} 个已解决/已归档的讨论串；/hub board --all 或 board_list all=true 查看）`);
  if (lines.length === 0) return "（还没有讨论串或任务）";
  return lines.join("\n");
}

/**
 * Serialize every board mutation per project.
 *
 * A periodic converge and a user-facing board_add can otherwise interleave
 * load/modify/write and silently drop one of the two updates. Writes are already
 * atomic; this closes the lost-update window on top of that.
 */
const boardChains = new Map();

function serialized(projectId, task) {
  const previous = boardChains.get(projectId) ?? Promise.resolve();
  const run = previous.then(task, task);
  boardChains.set(
    projectId,
    run.then(
      () => undefined,
      () => undefined
    )
  );
  return run;
}

export function addTask(store, projectId, input) {
  return serialized(projectId, () => addTaskInner(store, projectId, input));
}

export function updateTask(store, projectId, input) {
  return serialized(projectId, () => updateTaskInner(store, projectId, input));
}

export function removeTask(store, projectId, id) {
  return serialized(projectId, () => removeTaskInner(store, projectId, id));
}

export function convergeThreads(store, projectId, threads) {
  return serialized(projectId, () => convergeThreadsInner(store, projectId, threads));
}

/** Map a thread report status onto a board status. */
const REPORT_STATUS = { done: "done", idle: "pending", running: "doing", failed: "blocked" };

/**
 * Mirror thread reports onto the board as auto tasks, idempotently.
 *
 * One task per thread, keyed by threadId; a task is only rewritten when its
 * subject, status or note actually changed, so a periodic sweep costs nothing
 * when nothing happened. Manual tasks (no threadId) are never touched.
 */
async function convergeThreadsInner(store, projectId, threads) {
  const board = await loadBoard(store, projectId);
  let added = 0;
  let updated = 0;
  let dirty = false;
  for (const thread of threads) {
    const existing = board.tasks.find((task) => task.threadId === thread.id);
    // A resolved or archived thread must not create new tasks: importing 100 old
    // threads into the board is noise. If it already had one, close it out.
    if (thread.resolved === true || thread.archived === true) {
      if (existing !== undefined && existing.status !== "done") {
        existing.status = "done";
        existing.updatedAt = nowIso();
        updated += 1;
        dirty = true;
      }
      continue;
    }
    const report = thread.lastReport;
    if (report === null || report === undefined) continue;
    const summary = oneLine(report.summary ?? "", 200);
    if (summary.length === 0) continue;
    const subject = oneLine(`#${thread.n} ${thread.title}`, 120);
    const status = REPORT_STATUS[String(report.status)] ?? "pending";
    if (existing === undefined) {
      board.tasks.push({
        id: "b-" + board.nextId,
        subject,
        status,
        owner: null,
        note: summary,
        threadId: thread.id,
        createdAt: nowIso(),
        updatedAt: nowIso()
      });
      board.nextId += 1;
      added += 1;
      dirty = true;
      continue;
    }
    if (existing.subject !== subject || existing.status !== status || existing.note !== summary) {
      existing.subject = subject;
      existing.status = status;
      existing.note = summary;
      existing.updatedAt = nowIso();
      updated += 1;
      dirty = true;
    }
  }
  if (dirty) await store.write(projectId, FILE, board);
  return { added, updated };
}

/** Delete one manual or auto task. */
async function removeTaskInner(store, projectId, id) {
  const board = await loadBoard(store, projectId);
  const next = board.tasks.filter((task) => task.id !== id);
  if (next.length === board.tasks.length) throw new Error(`没有任务 ${id}`);
  board.tasks = next;
  await store.write(projectId, FILE, board);
  return true;
}

export function boardContextText(view, maxChars) {
  if (view.threads.length === 0 && view.tasks.length === 0) return "";
  return fit("## 项目看板\n" + boardText(view), maxChars);
}
