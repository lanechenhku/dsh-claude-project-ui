import { nowIso, oneLine } from "./util.js";
import { fit } from "./kb.js";
import { threadState } from "./project.js";

const FILE = "notes";

/**
 * Progress notes.
 *
 * The automatic half is derived live from dsh-threads' own thread records (last
 * report + state), so a thread that reports back shows up here without any extra
 * bookkeeping. The manual half is whatever the agents recorded with hub_note.
 */
export async function loadNotes(store, projectId) {
  const raw = await store.read(projectId, FILE, { notes: [], nextId: 1 });
  const notes = Array.isArray(raw.notes) ? raw.notes.filter((note) => note !== null && typeof note === "object" && typeof note.text === "string") : [];
  const nextId = Number(raw.nextId) > 0 ? Number(raw.nextId) : notes.length + 1;
  return { notes, nextId };
}

export function loadNotesSync(store, projectId) {
  const raw = store.readSync(projectId, FILE, { notes: [], nextId: 1 });
  const notes = Array.isArray(raw.notes) ? raw.notes.filter((note) => note !== null && typeof note === "object" && typeof note.text === "string") : [];
  const nextId = Number(raw.nextId) > 0 ? Number(raw.nextId) : notes.length + 1;
  return { notes, nextId };
}

export async function addNote(store, projectId, config, input, by) {
  const digest = await loadNotes(store, projectId);
  const text = oneLine(input.text ?? "", 400);
  if (text.length === 0) throw new Error("hub_note 需要 text");
  const note = {
    id: "n-" + digest.nextId,
    at: nowIso(),
    by: oneLine(by ?? "", 60) || null,
    kind: "manual",
    text
  };
  digest.notes.push(note);
  digest.nextId += 1;
  if (digest.notes.length > config.maxNotes) digest.notes = digest.notes.slice(-config.maxNotes);
  await store.write(projectId, FILE, digest);
  return note;
}

/** Merge automatic report events with manual notes, newest first. */
export function eventsOf(threads, notes) {
  const events = [];
  for (const thread of threads) {
    const report = thread.lastReport;
    if (report === null || report === undefined) continue;
    const summary = oneLine(report.summary ?? "", 200);
    if (summary.length === 0) continue;
    const decisions = Array.isArray(report.decisions) ? report.decisions.map((item) => oneLine(item, 80)).filter(Boolean) : [];
    const files = Array.isArray(report.changedFiles) ? report.changedFiles.map((item) => oneLine(item, 80)).filter(Boolean) : [];
    const extra = [];
    if (files.length > 0) extra.push("文件: " + files.slice(0, 4).join(", "));
    if (decisions.length > 0) extra.push("待定: " + decisions.slice(0, 3).join(" / "));
    events.push({
      at: String(thread.updatedAt ?? ""),
      label: `#${thread.n} ${oneLine(thread.title ?? "", 40)} — ${threadState(thread)}`,
      text: summary + (extra.length > 0 ? "（" + extra.join("；") + "）" : "")
    });
  }
  for (const note of notes) {
    events.push({ at: String(note.at ?? ""), label: note.by !== null ? "note · " + note.by : "note", text: note.text });
  }
  events.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  return events;
}

export function digestText(events, maxChars) {
  if (events.length === 0) return "";
  const lines = ["## 项目进展（来自主对话与其它讨论串的最近回报）"];
  for (const event of events.slice(0, 10)) {
    const time = event.at.slice(5, 16).replace("T", " ");
    lines.push(`- ${time} ${event.label}: ${event.text}`);
  }
  return fit(lines.join("\n"), maxChars);
}

/** The brief a lead can paste into `thread_open.task`; also what a thread sees on start. */
export function briefText({ project, kbIndex, view, events, maxChars }) {
  const parts = [];
  parts.push("# 项目上下文 · " + project.title);
  if (project.folder.length > 0) parts.push("目录：" + project.folder);
  parts.push("目标：" + (oneLine(project.goal, 400) || "（未设置）"));
  if (project.instructions.trim().length > 0) parts.push("项目说明：\n" + oneLine(project.instructions, 900));
  parts.push("");
  parts.push("## 看板");
  parts.push(viewLines(view));
  if (kbIndex.length > 0) {
    parts.push("");
    parts.push(kbIndex);
  }
  if (events.length > 0) {
    parts.push("");
    parts.push("## 最近进展");
    for (const event of events.slice(0, 8)) {
      parts.push(`- ${event.label}: ${event.text}`);
    }
  }
  parts.push("");
  parts.push("## 用法");
  parts.push("把它作为 `thread_open.task` 里的「背景」段落；讨论串会话还会自动收到同一份摘要，所以只补具体任务、边界与验收标准即可。");
  return fit(parts.filter((part) => part !== "").join("\n").replace(/\n{3,}/g, "\n\n"), maxChars);
}

function viewLines(view) {
  const lines = [];
  for (const thread of view.threads) {
    const branch = thread.branch !== null ? ` · ${thread.branch}` : "";
    lines.push(`- #${thread.n} ${thread.title} — ${thread.state}${branch}`);
  }
  for (const task of view.tasks) {
    const owner = task.owner !== null ? ` @${task.owner}` : "";
    lines.push(`- [${task.id}] ${task.subject} — ${task.status}${owner}`);
  }
  return lines.join("\n") || "（还没有讨论串或任务）";
}
