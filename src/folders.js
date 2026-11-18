import { realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import { nowIso } from "./util.js";

/**
 * Auxiliary folders mounted on a project, stored by this plugin only.
 *
 * dsh-threads owns the project and its main folder; this plugin never writes its
 * storage. These mounts are our own project record so the two data sets cannot
 * fight over one file: deleting either plugin leaves the other's data readable.
 *
 * Paths are stored canonical (physical) because the sandbox rejects a grant
 * spelled through a symlink — see dsh-sandbox/src/roots.ts additionalRoot().
 */
const FILE = "folders";

/** A mount list read from disk: always this shape, never undefined. */
export function emptyFolders() {
  return { folders: [], updatedAt: null };
}

export function normalizeFolders(raw) {
  const list = Array.isArray(raw?.folders) ? raw.folders : [];
  const folders = [];
  for (const entry of list) {
    if (typeof entry !== "string" || entry.length === 0) continue;
    if (!folders.includes(entry)) folders.push(entry);
  }
  return { folders, updatedAt: typeof raw?.updatedAt === "string" ? raw.updatedAt : null };
}

export async function loadFolders(store, projectId) {
  return normalizeFolders(await store.read(projectId, FILE, emptyFolders()));
}

/** Synchronous read, for priming a session before its first step. */
export function loadFoldersSync(store, projectId) {
  return normalizeFolders(store.readSync(projectId, FILE, emptyFolders()));
}

/** Expand `~`, then resolve the physical (symlink-free) path; must be an existing directory. */
export function canonicalFolder(input) {
  const text = String(input ?? "").trim();
  if (text.length === 0) throw new Error("需要一个文件夹路径（绝对路径，或 ~/ 开头）");
  const expanded = text === "~" ? homedir() : text.startsWith("~/") ? join(homedir(), text.slice(2)) : text;
  if (!isAbsolute(expanded)) throw new Error("不是绝对路径：" + expanded + "（请给绝对路径，或 ~/ 开头）");
  if (expanded.includes("\0")) throw new Error("路径里不能有 NUL 字符");
  let physical;
  try {
    physical = realpathSync.native(expanded);
  } catch (error) {
    throw new Error("读不到目录 " + expanded + "：" + String(error?.message ?? error));
  }
  let info;
  try {
    info = statSync(physical);
  } catch (error) {
    throw new Error("读不到目录 " + physical + "：" + String(error?.message ?? error));
  }
  if (!info.isDirectory()) throw new Error("不是目录：" + physical);
  return physical;
}

function canonicalOr(path) {
  try {
    return realpathSync.native(String(path));
  } catch {
    return String(path);
  }
}

/** Same physical directory, regardless of how the two paths were spelled. */
export function sameFolder(a, b) {
  return canonicalOr(a) === canonicalOr(b);
}

/** Whether `target` is `root` itself or lies under it (both compared physically). */
export function isInside(target, root) {
  if (typeof target !== "string" || typeof root !== "string" || root.length === 0) return false;
  const child = canonicalOr(target);
  const parent = canonicalOr(root);
  if (child === parent) return true;
  const rel = relative(parent, child);
  return rel.length > 0 && !rel.startsWith("..") && !isAbsolute(rel);
}

/**
 * Which mount a path belongs to: the project main folder or one of the extra
 * folders. `null` means "outside every folder this project mounted".
 */
export function folderForPath(target, projectFolder, extraFolders) {
  if (typeof target !== "string" || target.length === 0) return null;
  const roots = [];
  if (typeof projectFolder === "string" && projectFolder.length > 0) roots.push(projectFolder);
  for (const folder of extraFolders ?? []) roots.push(folder);
  for (const root of roots) {
    if (isInside(target, root)) return root;
  }
  return null;
}

/** Paths that may be handed to `registerWritableRoot`: extras minus the main folder. */
export function grantFolders(projectFolder, extraFolders) {
  const out = [];
  for (const folder of extraFolders ?? []) {
    if (projectFolder && sameFolder(folder, projectFolder)) continue;
    if (!out.some((entry) => sameFolder(entry, folder))) out.push(folder);
  }
  return out;
}

/**
 * Serialize the mount list's read-modify-write per project. Writes are atomic
 * already (util.writeJson); this closes the lost-update window between two
 * panel clicks or a panel click and a command.
 */
const chains = new Map();

function queued(projectId, task) {
  const previous = chains.get(projectId) ?? Promise.resolve();
  const run = previous.then(task, task);
  chains.set(
    projectId,
    run.then(
      () => undefined,
      () => undefined
    )
  );
  return run;
}

async function addFolderInner(store, projectId, input) {
  const projectFolder = typeof input?.projectFolder === "string" ? input.projectFolder : "";
  // 0 is a valid setting ("no mounts"); only a missing / non-numeric cap falls back.
  const max = Number.isFinite(input?.max) ? Math.max(0, Math.trunc(input.max)) : 8;
  const physical = canonicalFolder(input?.path);
  if (projectFolder.length > 0 && sameFolder(physical, projectFolder)) {
    throw new Error("这已经是项目主文件夹：" + physical);
  }
  const state = await loadFolders(store, projectId);
  if (state.folders.some((entry) => sameFolder(entry, physical))) {
    throw new Error("已经挂载过了：" + physical);
  }
  if (state.folders.length >= max) throw new Error("最多 " + max + " 个辅助文件夹；先移除一个再添加");
  const next = { folders: [...state.folders, physical], updatedAt: nowIso() };
  await store.write(projectId, FILE, next);
  return next;
}

async function removeFolderInner(store, projectId, path) {
  const state = await loadFolders(store, projectId);
  const next = state.folders.filter((entry) => !sameFolder(entry, path));
  if (next.length === state.folders.length) throw new Error("没有挂载这个文件夹：" + String(path ?? ""));
  const after = { folders: next, updatedAt: nowIso() };
  await store.write(projectId, FILE, after);
  return after;
}

export function addFolder(store, projectId, input) {
  return queued(projectId, () => addFolderInner(store, projectId, input));
}

export function removeFolder(store, projectId, path) {
  return queued(projectId, () => removeFolderInner(store, projectId, path));
}
