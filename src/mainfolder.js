import { copyFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { canonicalFolder, isInside, sameFolder } from "./folders.js";
import { nowIso, readJson, writeJson } from "./util.js";

/**
 * Switching a project's MAIN folder — written into dsh-threads' own record.
 *
 * Upstream PR #61 (Kyf-eng/dsh-threads) does this inside dsh-threads itself. This
 * module ports the server-side behaviour so the panel can offer the switch without
 * waiting for that PR:
 *
 *  - Two records move, because two different things read them:
 *      dsh_threads.json  tables.projects[id].folder    what dsh-threads renders,
 *                                                     and what our panel reads
 *      workspace.json    tables.workspaces[id].path    what DSH uses to place a
 *                                                     NEW session in a directory
 *    Writing only the first one would show a new folder while every new session
 *    still opened the old one — a lie. Both move, or nothing does.
 *  - DSH's workspace registry caches its records for the life of the process
 *    (the same reason dsh-threads' PR #61 needs a restart), so the *current*
 *    conversation keeps its directory and only sessions created after a restart
 *    use the new one. This module never touches a live session's working
 *    directory — that is the whole guarantee.
 *  - Writes go through the storage-domain handles when the host exposes them:
 *    the domain's in-memory state is authoritative and its single write chain
 *    serialises every write, so a direct file edit would be overwritten by the
 *    next dsh-threads write (lost update). The file path is a fallback for hosts
 *    or tests without the service; it re-reads immediately before writing,
 *    backs the file up, writes atomically and rolls back on any failure.
 */

/** dsh-threads' storage domain name — a private contract, see docs/folders-feasibility.md. */
const THREADS_DOMAIN = "dsh_threads";
/** DSH core's workspace domain: the record a new session's directory comes from. */
const WORKSPACE_DOMAIN = "workspace";

/** Directory roots a project must never be pointed at, in any spelling. */
const SYSTEM_ROOTS = ["/", "/Applications", "/System", "/Library", "/usr", "/bin", "/sbin", "/etc", "/dev", "/cores"];
/** Trees whose contents are refused too: an app bundle or a system tree is never a project. */
const PROTECTED_TREES = ["/Applications", "/System", "/Library"];

/** workspace.json sits next to dsh_threads.json in DSH's storages directory. */
export function defaultWorkspaceStorage(threadsStorage) {
  const path = String(threadsStorage ?? "").trim();
  if (path.length === 0) return "";
  return join(dirname(path), "workspace.json");
}

function expandHome(path) {
  const text = String(path ?? "");
  return text === "~" ? homedir() : text.startsWith("~/") ? join(homedir(), text.slice(2)) : text;
}

/**
 * Refuse a target that exists and is a directory but must never become a project
 * root: the filesystem root, system trees, the DSH home, ~/.ssh and this plugin's
 * own data directory. Called with a canonical (physical) path.
 */
export function assertSafeMainFolder(canonical, protectedTrees = []) {
  const home = canonicalFolder(homedir());
  const path = String(canonical ?? "");
  if (path.length === 0) throw new Error("需要一个文件夹路径");
  for (const root of SYSTEM_ROOTS) {
    if (path === root) throw new Error("不能把项目主文件夹设成 " + root + "：这是系统目录");
  }
  for (const tree of PROTECTED_TREES) {
    if (isInside(path, tree)) throw new Error("不能把项目主文件夹设成系统目录里的 " + path);
  }
  if (path === home) {
    throw new Error("不能把项目主文件夹设成用户主目录本身：" + home + "（请选它下面的具体目录）");
  }
  const trees = [join(home, ".dsh"), join(home, ".ssh")].concat(
    protectedTrees.filter((entry) => typeof entry === "string" && entry.length > 0)
  );
  for (const tree of trees) {
    if (isInside(path, tree)) {
      throw new Error("不能把项目主文件夹设成 " + path + "：它在 " + tree + " 里面（DSH 与插件自己的数据）");
    }
  }
  return path;
}

/** Absolute + existing + a directory + not a dangerous root; returns the physical path. */
export function validateMainFolder(input, protectedTrees = []) {
  const expanded = expandHome(input);
  if (expanded.includes("\u0000")) throw new Error("路径里不能有 NUL 字符");
  const canonical = canonicalFolder(expanded);
  return assertSafeMainFolder(canonical, protectedTrees);
}

// ---- storage access -------------------------------------------------------
// Two backends behind one tiny interface: the storage-domain handle (authoritative
// in-memory state + serialised writes) and a JSON file (fallback; backup + atomic
// rename + verification).

function tableFrom(facility, domain, table) {
  try {
    const handle = typeof facility?.get === "function" ? facility.get(domain) : undefined;
    const found = typeof handle?.table === "function" ? handle.table(table) : undefined;
    if (found === undefined || found === null) return undefined;
    if (typeof found.get !== "function" || typeof found.update !== "function") return undefined;
    if (typeof found.entries !== "function") return undefined;
    return found;
  } catch {
    return undefined;
  }
}

function tableOf(doc, name) {
  const table = doc?.tables?.[name];
  return table !== null && typeof table === "object" ? table : null;
}

function recordOf(doc, name, id) {
  const table = tableOf(doc, name);
  if (table === null) return null;
  if (Array.isArray(table)) {
    return table.find((entry) => entry !== null && typeof entry === "object" && entry.id === id) ?? null;
  }
  const record = table[id];
  return record !== null && typeof record === "object" ? record : null;
}

function recordsOf(doc, name) {
  const table = tableOf(doc, name);
  if (table === null) return [];
  const values = Array.isArray(table) ? table : Object.values(table);
  return values.filter((entry) => entry !== null && typeof entry === "object");
}

function setRecord(doc, name, id, record) {
  const table = tableOf(doc, name);
  if (table === null) {
    throw new Error("存储里没有 " + name + " 这张表：" + JSON.stringify(Object.keys(doc?.tables ?? {})));
  }
  if (Array.isArray(table)) {
    const index = table.findIndex((entry) => entry !== null && typeof entry === "object" && entry.id === id);
    if (index === -1) throw new Error(name + " 表里没有 " + id);
    table[index] = record;
    return;
  }
  table[id] = record;
}

async function readDoc(file) {
  const doc = await readJson(file, null);
  return doc !== null && typeof doc === "object" ? doc : null;
}

/** One table of one storage file; the record is replaced whole (unknown fields stay). */
function fileTarget(file, tableName, label) {
  return {
    via: "file",
    async read(id) {
      const doc = await readDoc(file);
      if (doc === null) throw new Error("读不到 " + label + "：" + file);
      return recordOf(doc, tableName, id);
    },
    async write(id, record) {
      // Read immediately before the write: another writer (dsh-threads itself)
      // may have changed the file since our first read, and this write must not
      // resurrect a stale snapshot of it.
      const doc = await readDoc(file);
      if (doc === null) throw new Error("读不到 " + label + "：" + file);
      setRecord(doc, tableName, id, record);
      await writeJson(file, doc);
    },
    async restore(id, field, value) {
      const doc = await readDoc(file);
      if (doc === null) throw new Error("读不到 " + label + "：" + file);
      const current = recordOf(doc, tableName, id);
      if (current === null) return;
      setRecord(doc, tableName, id, { ...current, [field]: value });
      await writeJson(file, doc);
    },
    async list() {
      const doc = await readDoc(file);
      return doc === null ? [] : recordsOf(doc, tableName);
    }
  };
}

/** The same table through the domain handle dsh-threads / DSH already opened. */
function handleTarget(table) {
  return {
    via: "service",
    async read(id) {
      return table.get(id) ?? null;
    },
    async write(id, record) {
      // update() runs on the domain's write chain: it sees the record current at
      // its queue slot, so a concurrent dsh-threads write cannot interleave.
      await table.update(id, () => record);
    },
    async restore(id, field, value) {
      await table.update(id, (current) => ({ ...current, [field]: value }));
    },
    async list() {
      return [...table.entries()].map(([, record]) => record);
    }
  };
}

function projectTarget(facility, threadsFile) {
  const table = tableFrom(facility, THREADS_DOMAIN, "projects");
  if (table !== undefined) return handleTarget(table);
  return fileTarget(threadsFile, "projects", "dsh-threads 存储");
}

function workspaceTarget(facility, workspaceFile) {
  const table = tableFrom(facility, WORKSPACE_DOMAIN, "workspaces");
  if (table !== undefined) return handleTarget(table);
  if (workspaceFile.length === 0) throw new Error("没有 workspace 存储路径，无法把新会话指向新目录");
  return fileTarget(workspaceFile, "workspaces", "DSH workspace 存储");
}

// ---- serialisation --------------------------------------------------------

/** One read-modify-write at a time per storage pair, so two clicks cannot interleave. */
const chains = new Map();

function serialized(key, task) {
  const previous = chains.get(key) ?? Promise.resolve();
  const run = previous.then(task, task);
  chains.set(
    key,
    run.then(
      () => undefined,
      () => undefined
    )
  );
  return run;
}

// ---- the writer -----------------------------------------------------------

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function backup(file) {
  if (typeof file !== "string" || file.length === 0) return null;
  const target = file + ".bak-mainfolder-" + stamp();
  try {
    await copyFile(file, target);
    return target;
  } catch {
    // A missing storage file has nothing to back up; the writer still refuses to
    // continue when it cannot read its own source of truth.
    return null;
  }
}

async function resolveWorkspace(workspaces, project) {
  const id = typeof project.workspaceId === "string" ? project.workspaceId.trim() : "";
  if (id.length > 0) {
    const record = await workspaces.read(id);
    if (record !== null) return record;
  }
  const session = typeof project.mainSessionId === "string" ? project.mainSessionId.trim() : "";
  if (session.length === 0) return null;
  for (const record of await workspaces.list()) {
    if (Array.isArray(record.sessionIds) && record.sessionIds.includes(session)) return record;
  }
  return null;
}

/**
 * Move one project's main folder to `folder`.
 *
 * Options:
 *   facility           the storageDomain service handle, when the host exposes it
 *   threadsPath        dsh_threads.json
 *   workspacePath      workspace.json (default: next to threadsPath)
 *   projectId          the dsh-threads project id
 *   folder             what the user picked (absolute, ~/…, any spelling)
 *   protectedTrees     extra directories to refuse (this plugin's own data dir)
 */
export function setMainFolder(options) {
  const threadsFile = String(options?.threadsPath ?? "").trim();
  if (threadsFile.length === 0) throw new Error("没有配置 dsh-threads 存储路径（threadsStorage）");
  const workspaceFile = String(options?.workspacePath ?? "").trim() || defaultWorkspaceStorage(threadsFile);
  const projectId = String(options?.projectId ?? "").trim();
  if (projectId.length === 0) throw new Error("缺少 projectId");
  return serialized(threadsFile + "\n" + workspaceFile, () =>
    setMainFolderInner({ ...options, threadsFile, workspaceFile, projectId })
  );
}

async function setMainFolderInner(options) {
  const folder = validateMainFolder(options.folder, options.protectedTrees);
  const projects = projectTarget(options.facility, options.threadsFile);
  const workspaces = workspaceTarget(options.facility, options.workspaceFile);

  const project = await projects.read(options.projectId);
  if (project === null) throw new Error("dsh-threads 里没有这个项目：" + options.projectId);
  const before = typeof project.folder === "string" ? project.folder : "";

  if (before.length > 0 && sameFolder(before, folder)) {
    return { changed: false, projectId: options.projectId, before, folder, workspace: null, backups: [], via: projects.via };
  }

  // The workspace record is what a new session's directory is read from. Without
  // it the switch would only change what the UI shows, so this refuses instead.
  const workspace = await resolveWorkspace(workspaces, project);
  if (workspace === null) {
    throw new Error(
      "找不到这个项目的 DSH workspace 记录（workspaceId=" + String(project.workspaceId ?? "无") +
        "）：新会话的目录来自它，没有它就切了也不生效，所以没有写。"
    );
  }
  // DSH checks at startup that no two workspaces claim one directory.
  for (const other of await workspaces.list()) {
    if (other === null || typeof other !== "object") continue;
    if (other.id === workspace.id) continue;
    if (typeof other.path !== "string" || other.path.length === 0) continue;
    if (sameFolder(other.path, folder)) {
      throw new Error(
        "另一个工作区已经用了这个目录：" + folder + "（" + other.id +
          "）。换一个目录，否则 DSH 启动时的 workspace 一致性检查会失败。"
      );
    }
  }

  const backups = [];
  for (const file of [options.threadsFile, options.workspaceFile]) {
    const copy = await backup(file);
    if (copy !== null) backups.push(copy);
  }

  const at = nowIso();
  let wroteWorkspace = false;
  let wroteProject = false;
  try {
    // 1) the workspace record: the only thing that decides where a session created
    //    after the next DSH start works. DSH keeps the registry in memory for the
    //    life of the process, so nothing moves before that restart, and this module
    //    never moves a live session's directory.
    await workspaces.write(workspace.id, { ...workspace, path: folder });
    wroteWorkspace = true;
    // 2) the project record: what dsh-threads renders and what our panel reads.
    await projects.write(options.projectId, { ...project, folder, updatedAt: at });
    wroteProject = true;

    const afterProject = await projects.read(options.projectId);
    if (afterProject === null || afterProject.folder !== folder) {
      throw new Error("写入后读回的 folder 是 " + String(afterProject?.folder ?? "（没有记录）") + "，不是 " + folder);
    }
    const afterWorkspace = await workspaces.read(workspace.id);
    if (afterWorkspace === null || afterWorkspace.path !== folder) {
      throw new Error("写入后读回的 workspace 路径是 " + String(afterWorkspace?.path ?? "（没有记录）") + "，不是 " + folder);
    }
  } catch (error) {
    const problems = [];
    if (wroteProject) {
      await projects
        .restore(options.projectId, "folder", before)
        .catch((failure) => problems.push(String(failure?.message ?? failure)));
    }
    if (wroteWorkspace) {
      await workspaces
        .restore(workspace.id, "path", typeof workspace.path === "string" ? workspace.path : "")
        .catch((failure) => problems.push(String(failure?.message ?? failure)));
    }
    const head = "切换主文件夹失败，已回滚到 " + (before.length > 0 ? before : "原值");
    const reason = String(error?.message ?? error);
    const tail = problems.length === 0 ? "" : "；回滚也出了问题：" + problems.join("；");
    const keep = backups.length === 0 ? "" : "（备份：" + backups.join("、") + "）";
    throw new Error(head + "：" + reason + tail + keep);
  }

  return {
    changed: true,
    projectId: options.projectId,
    before,
    folder,
    workspace: { id: workspace.id, before: typeof workspace.path === "string" ? workspace.path : "", path: folder },
    backups,
    via: projects.via === "service" && workspaces.via === "service" ? "service" : "file",
    // The UI must say this: only sessions created after a DSH restart use it.
    restartRequired: true
  };
}
/**
 * Move one bare workspace's path — a workspace no dsh-threads project owns.
 *
 * Same discipline as {@link setMainFolder} (validate, back up, write, read back,
 * roll back), but only workspace.json moves because there is no project record to
 * keep in step. A workspace a project owns must be changed from that project:
 * rewriting only the workspace would leave the project's folder pointing at the
 * old directory while new sessions go somewhere else.
 *
 * Options: facility, workspacePath, workspaceId, folder, protectedTrees.
 */
export function setWorkspaceFolder(options) {
  const workspaceFile = String(options?.workspacePath ?? "").trim();
  if (workspaceFile.length === 0) throw new Error("没有 workspace 存储路径（workspaceStorage）");
  const workspaceId = String(options?.workspaceId ?? "").trim();
  if (workspaceId.length === 0) throw new Error("缺少 workspaceId");
  return serialized("workspace\n" + workspaceFile, () =>
    setWorkspaceFolderInner({ ...options, workspaceFile, workspaceId })
  );
}

async function setWorkspaceFolderInner(options) {
  const folder = validateMainFolder(options.folder, options.protectedTrees);
  const workspaces = workspaceTarget(options.facility, options.workspaceFile);

  const workspace = await workspaces.read(options.workspaceId);
  if (workspace === null) throw new Error("DSH workspace 存储里没有 " + options.workspaceId);
  const before = typeof workspace.path === "string" ? workspace.path : "";
  if (before.length > 0 && sameFolder(before, folder)) {
    return {
      changed: false,
      workspaceId: options.workspaceId,
      before,
      folder,
      backups: [],
      via: workspaces.via,
      restartRequired: false
    };
  }
  // DSH refuses to start when two workspaces claim one directory.
  for (const other of await workspaces.list()) {
    if (other === null || typeof other !== "object") continue;
    if (other.id === options.workspaceId) continue;
    if (typeof other.path !== "string" || other.path.length === 0) continue;
    if (sameFolder(other.path, folder)) {
      throw new Error(
        "另一个工作区已经用了这个目录：" + folder + "（" + other.id + "）。换一个目录，否则 DSH 启动时的 workspace 一致性检查会失败。"
      );
    }
  }

  const backups = [];
  const copy = await backup(options.workspaceFile);
  if (copy !== null) backups.push(copy);

  let wrote = false;
  try {
    await workspaces.write(options.workspaceId, { ...workspace, path: folder });
    wrote = true;
    const after = await workspaces.read(options.workspaceId);
    if (after === null || after.path !== folder) {
      throw new Error("写入后读回的路径是 " + String(after?.path ?? "（没有记录）") + "，不是 " + folder);
    }
  } catch (error) {
    const problems = [];
    if (wrote) {
      await workspaces
        .restore(options.workspaceId, "path", before)
        .catch((failure) => problems.push(String(failure?.message ?? failure)));
    }
    const head = "切换工作区文件夹失败，已回滚到 " + (before.length > 0 ? before : "原值");
    const tail = problems.length === 0 ? "" : "；回滚也出了问题：" + problems.join("；");
    const keep = backups.length === 0 ? "" : "（备份：" + backups.join("、") + "）";
    throw new Error(head + "：" + String(error?.message ?? error) + tail + keep);
  }

  return {
    changed: true,
    workspaceId: options.workspaceId,
    before,
    folder,
    backups,
    via: workspaces.via,
    // Only sessions created after a DSH restart are placed from the new path.
    restartRequired: true
  };
}
