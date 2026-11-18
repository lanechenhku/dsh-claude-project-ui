import { readFile, stat } from "node:fs/promises";
import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Read-only view of the dsh-threads project registry.
 *
 * dsh-threads owns projects and threads; this plugin never writes to it and never
 * imports its modules. It only reads the storage file those records live in, so the
 * two plugins stay independent: removing either one leaves the other working.
 */
export function defaultThreadsStorage() {
  return join(homedir(), ".dsh", "storages", "dsh_threads.json");
}

const CACHE_TTL_MS = 1200;

export class ProjectRegistry {
  constructor(storagePath) {
    this.path = storagePath;
    this.cache = { at: 0, mtimeMs: -1, data: null };
  }

  async load() {
    const now = Date.now();
    let mtimeMs = -1;
    try {
      mtimeMs = (await stat(this.path)).mtimeMs;
    } catch {
      this.cache = { at: now, mtimeMs: -1, data: empty() };
      return this.cache.data;
    }
    if (this.cache.data !== null && this.cache.mtimeMs === mtimeMs && now - this.cache.at < CACHE_TTL_MS) {
      return this.cache.data;
    }
    let parsed = null;
    try {
      parsed = JSON.parse(await readFile(this.path, "utf8"));
    } catch {
      parsed = null;
    }
    const data = normalize(parsed);
    this.cache = { at: now, mtimeMs, data };
    return data;
  }

  /** Drop the cached parse: called after this plugin changes dsh-threads' record
   * so the next snapshot reads what is on disk now instead of a stale copy. */
  invalidate() {
    this.cache = { at: 0, mtimeMs: -1, data: null };
  }

  /** Every project, newest activity first. */
  async projects() {
    const { projects } = await this.load();
    return [...projects.values()].sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")));
  }

  /** Resolve what role a session plays inside the project world. */
  async roleOf(sessionId) {
    const { projects, threadsBySession } = await this.load();
    for (const project of projects.values()) {
      if (project.mainSessionId === sessionId) {
        return { kind: "main", project, thread: null };
      }
    }
    const thread = threadsBySession.get(sessionId);
    if (thread === undefined) return { kind: "none", project: null, thread: null };
    const project = projects.get(thread.projectId) ?? null;
    if (project === null) return { kind: "none", project: null, thread };
    return { kind: "thread", project, thread };
  }

  /**
   * Same as roleOf, but synchronous: used from agent/created so a thread session has
   * its sections and tools registered before its first step is prepared. The file is
   * small and the parse is cached by mtime.
   */
  ensureSync() {
    const now = Date.now();
    let mtimeMs = -1;
    try {
      mtimeMs = statSync(this.path).mtimeMs;
    } catch {
      this.cache = { at: now, mtimeMs: -1, data: empty() };
      return this.cache.data;
    }
    if (this.cache.data === null || this.cache.mtimeMs !== mtimeMs) {
      let parsed = null;
      try {
        parsed = JSON.parse(readFileSync(this.path, "utf8"));
      } catch {
        parsed = null;
      }
      this.cache = { at: now, mtimeMs, data: normalize(parsed) };
    }
    return this.cache.data;
  }

  threadsOfSync(projectId) {
    return this.ensureSync()
      .threads.filter((thread) => thread.projectId === projectId)
      .sort((a, b) => (a.n ?? 0) - (b.n ?? 0));
  }

  roleOfSync(sessionId) {
    const { projects, threadsBySession } = this.ensureSync();
    for (const project of projects.values()) {
      if (project.mainSessionId === sessionId) return { kind: "main", project, thread: null };
    }
    const thread = threadsBySession.get(sessionId);
    if (thread === undefined) return { kind: "none", project: null, thread: null };
    const project = projects.get(thread.projectId) ?? null;
    if (project === null) return { kind: "none", project: null, thread };
    return { kind: "thread", project, thread };
  }

  /** Threads of one project, by thread number. */
  async threadsOf(projectId) {
    const { threads } = await this.load();
    return threads
      .filter((thread) => thread.projectId === projectId)
      .sort((a, b) => (a.n ?? 0) - (b.n ?? 0));
  }
}

function empty() {
  return { projects: new Map(), threads: [], threadsBySession: new Map() };
}

function normalize(parsed) {
  const tables = parsed?.tables;
  if (tables === null || typeof tables !== "object") return empty();
  const projects = new Map();
  const rawProjects = toArray(tables.projects);
  for (const raw of rawProjects) {
    if (raw === null || typeof raw !== "object" || typeof raw.id !== "string") continue;
    const project = {
      id: raw.id,
      title: String(raw.title ?? "未命名项目"),
      folder: typeof raw.folder === "string" ? raw.folder : "",
      // Present only when the installed dsh-threads has the upstream folder
      // feature (PR #61). Read-only here: its own list, never ours.
      extraFolders: Array.isArray(raw.extraFolders)
        ? raw.extraFolders.filter((entry) => typeof entry === "string" && entry.length > 0)
        : [],
      mainSessionId: typeof raw.mainSessionId === "string" ? raw.mainSessionId : "",
      instructions: typeof raw.instructions === "string" ? raw.instructions : "",
      goal: typeof raw.goal === "string" ? raw.goal : "",
      archived: raw.archived === true,
      updatedAt: String(raw.updatedAt ?? raw.createdAt ?? "")
    };
    projects.set(project.id, project);
  }
  const threads = [];
  const threadsBySession = new Map();
  for (const raw of toArray(tables.threads)) {
    if (raw === null || typeof raw !== "object" || typeof raw.id !== "string") continue;
    const mainSessionId = String(raw.mainSessionId ?? "");
    const project = [...projects.values()].find((candidate) => candidate.mainSessionId === mainSessionId) ?? null;
    const thread = {
      id: raw.id,
      projectId: project?.id ?? "",
      mainSessionId,
      n: Number(raw.n ?? 0) || 0,
      title: String(raw.title ?? ""),
      status: String(raw.status ?? ""),
      resolved: raw.resolved === true,
      archived: raw.archived === true,
      stopped: raw.stopped === true,
      worktree: raw.worktree ?? null,
      lastReport: raw.lastReport ?? null,
      updatedAt: String(raw.updatedAt ?? raw.createdAt ?? "")
    };
    threads.push(thread);
    threadsBySession.set(thread.id, thread);
  }
  return { projects, threads, threadsBySession };
}

function toArray(table) {
  if (table === null || table === undefined) return [];
  if (Array.isArray(table)) return table;
  if (typeof table === "object") return Object.values(table);
  return [];
}

/** Human label for a thread's latest state, used by the board and the digest. */
export function threadState(thread) {
  const report = thread.lastReport ?? null;
  const reportStatus = typeof report?.status === "string" ? report.status : "";
  if (thread.stopped === true) return "已停止";
  if (thread.resolved === true) return "已解决";
  if (reportStatus === "needs_decision") return "待决策";
  if (reportStatus === "blocked") return "受阻";
  if (reportStatus === "failed") return "失败";
  if (thread.status === "running") return "进行中";
  if (thread.status === "idle") return "空闲";
  if (thread.status === "starting") return "启动中";
  if (thread.status === "failed") return "失败";
  return thread.status === "" ? "未知" : thread.status;
}

export function threadBranch(thread) {
  const branch = thread?.worktree?.branch;
  return typeof branch === "string" && branch.length > 0 ? branch : null;
}
