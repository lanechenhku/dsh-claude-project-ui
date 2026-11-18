import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { readJson, writeJson } from "./util.js";

/** Filesystem-backed per-project store; one small JSON file per concern. */
export class ProjectStore {
  constructor(config) {
    const base = String(config.dataDir ?? "").trim();
    this.root = base.length > 0 ? expand(base) : join(homedir(), ".dsh", "project-hub");
  }

  dir(projectId) {
    return join(this.root, "projects", sanitize(projectId));
  }

  file(projectId, name) {
    return join(this.dir(projectId), name + ".json");
  }

  /** Synchronous read, for priming a brand-new session before its first step. */
  readSync(projectId, name, fallback) {
    try {
      const value = JSON.parse(readFileSync(this.file(projectId, name), "utf8"));
      return value === null || typeof value !== "object" ? fallback : value;
    } catch {
      return fallback;
    }
  }

  async read(projectId, name, fallback) {
    const value = await readJson(this.file(projectId, name), null);
    return value === null || typeof value !== "object" ? fallback : value;
  }

  async write(projectId, name, value) {
    await writeJson(this.file(projectId, name), value);
    return value;
  }

  /**
   * A file that belongs to the install rather than to one project.
   *
   * The panel's own preferences (language override, thread visibility, sort)
   * live here: they are not project data, and they must never be written into
   * dsh-threads' storage.
   */
  globalFile(name) {
    return join(this.root, name + ".json");
  }

  readGlobalSync(name, fallback) {
    try {
      const value = JSON.parse(readFileSync(this.globalFile(name), "utf8"));
      return value === null || typeof value !== "object" ? fallback : value;
    } catch {
      return fallback;
    }
  }

  async readGlobal(name, fallback) {
    const value = await readJson(this.globalFile(name), null);
    return value === null || typeof value !== "object" ? fallback : value;
  }

  async writeGlobal(name, value) {
    await writeJson(this.globalFile(name), value);
    return value;
  }
}

function expand(path) {
  return path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
}

function sanitize(id) {
  return String(id).replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120);
}
