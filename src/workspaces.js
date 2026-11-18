import { readJson } from "./util.js";

/**
 * Read-only view of DSH's workspace records.
 *
 * A workspace is what DSH places a NEW session's directory from
 * (tables.workspaces[id].path). dsh-threads projects each point at one through
 * workspaceId, so the settings page lists both: a project row is the honest edit
 * target when the workspace belongs to a project (two records must move together),
 * and a bare workspace row is the only thing to edit otherwise.
 *
 * This module only reads. Every write goes through src/mainfolder.js so there is
 * exactly one writer with one backup / validation / rollback discipline.
 */

/** A workspace record, normalised to the shape the panel renders. */
export function normalizeWorkspace(raw) {
  if (raw === null || typeof raw !== "object") return null;
  const id = typeof raw.id === "string" ? raw.id : "";
  if (id.length === 0) return null;
  return {
    id,
    title: typeof raw.title === "string" && raw.title.length > 0 ? raw.title : id,
    path: typeof raw.path === "string" ? raw.path : "",
    sessionCount: Array.isArray(raw.sessionIds) ? raw.sessionIds.length : 0,
    updatedAt: String(raw.updatedAt ?? raw.createdAt ?? "")
  };
}

function recordsOf(doc) {
  const table = doc?.tables?.workspaces;
  if (table === null || table === undefined) return [];
  const values = Array.isArray(table) ? table : Object.values(table);
  return values.filter((entry) => entry !== null && typeof entry === "object");
}

/**
 * Every workspace, newest activity first.
 *
 * The file is read-only input here: an unreadable file yields an empty list.
 *
 * @param file - workspace.json path.
 * @returns normalised records; never throws.
 */
export async function listWorkspaces(file) {
  const path = String(file ?? "").trim();
  if (path.length === 0) return [];
  const doc = await readJson(path, null);
  if (doc === null || typeof doc !== "object") return [];
  const out = [];
  for (const raw of recordsOf(doc)) {
    const record = normalizeWorkspace(raw);
    if (record !== null) out.push(record);
  }
  out.sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")) || a.id.localeCompare(b.id));
  return out;
}

/**
 * Join workspaces with the projects that own them.
 *
 * @param workspaces - from listWorkspaces.
 * @param projects - normalised dsh-threads projects (each carries workspaceId and
 *   extraFolderCount).
 * @returns one row per workspace carrying the owning project id (null when
 *   unowned), the project's auxiliary-folder count, and whether this row may be
 *   edited directly. A project whose workspace record is missing still gets a
 *   row, marked missing, so the page can say so instead of hiding it.
 */
export function workspaceRows(workspaces, projects) {
  const byProject = new Map();
  for (const project of projects ?? []) {
    const id = typeof project?.workspaceId === "string" ? project.workspaceId : "";
    if (id.length > 0) byProject.set(id, project);
  }
  const rows = [];
  for (const workspace of workspaces ?? []) {
    const project = byProject.get(workspace.id) ?? null;
    rows.push({
      id: workspace.id,
      title: workspace.title,
      path: workspace.path,
      sessionCount: workspace.sessionCount,
      projectId: project?.id ?? null,
      extraFolderCount: project?.extraFolderCount ?? 0,
      // A project-owned workspace is changed from the project row: both records
      // must move together, and the project path does exactly that.
      editable: project === null
    });
    byProject.delete(workspace.id);
  }
  for (const [id, project] of byProject) {
    rows.push({
      id,
      title: project.title,
      path: "",
      sessionCount: 0,
      projectId: project.id,
      extraFolderCount: project.extraFolderCount ?? 0,
      editable: false,
      missing: true
    });
  }
  return rows;
}
