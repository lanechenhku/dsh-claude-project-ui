import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { resolveConfig } from "./config.js";
import { defaultThreadsStorage, projectActivity, ProjectRegistry } from "./project.js";
import { ProjectStore } from "./store.js";
import { createTools } from "./tools.js";
import { registerHubCommand } from "./command.js";
import {
  BOARD_CONTEXT,
  CONTEXT_ORDER,
  DIGEST_CONTEXT,
  DIGEST_ORDER,
  FOLDERS_ORDER,
  FOLDERS_SECTION,
  KB_SECTION,
  SECTION_ORDER,
  boardSectionText,
  digestSectionText,
  foldersSectionText,
  kbSectionText
} from "./prompts.js";
import { addFolder, grantFolders, loadFolders, loadFoldersSync, removeFolder } from "./folders.js";
import { defaultWorkspaceStorage, setMainFolder, setWorkspaceFolder } from "./mainfolder.js";
import { listWorkspaces, workspaceRows } from "./workspaces.js";
import { loadSettings, saveSettings } from "./settings.js";
import { kbIndexText, loadKb, loadKbSync } from "./kb.js";
import { boardContextText, boardView, convergeThreads, loadBoard, loadBoardSync } from "./board.js";
import { digestText, eventsOf, loadNotes, loadNotesSync } from "./digest.js";

export const name = "dsh-claude-project-ui";
// webServer is declared because Cordis refuses `ctx.get("webServer")` / `ctx.webServer`
// unless the service is injected. Profiles without a web server (tui / headless) simply
// keep this plugin waiting, which is the same trade-off dsh-git-graph makes.
// storageDomain is declared for the same reason: switching a project's main folder has
// to write through the domain handle dsh-threads and DSH already opened, or their next
// write reverts the change (see src/mainfolder.js). It is a core DSH service.
export const inject = ["tools", "agents", "commands", "webServer", "storageDomain"];

// Both helpers live in the DSH host. Resolve them defensively so the module also
// loads outside the host (tests, tooling) instead of failing at import time.
let defineTool = (spec) => spec;
try {
  const mod = await import("@deepseek-ai/dsh-tools");
  if (typeof mod.defineTool === "function") defineTool = mod.defineTool;
} catch {
  // not running inside the host
}

let commandDefinitionId = (value) => value;
try {
  const mod = await import("@deepseek-ai/dsh-commands/brand");
  if (typeof mod.CommandDefinitionId === "function") commandDefinitionId = mod.CommandDefinitionId;
} catch {
  // not running inside the host
}

const REFRESH_MS = 10000;

// Startup breadcrumbs: DSH swallows plugin load errors, so write them to a file
// we can read after a restart instead of guessing why the plugin did not mount.
const LOAD_LOG = join(homedir(), ".dsh", "project-hub", "_load.log");

function breadcrumb(message) {
  try {
    mkdirSync(dirname(LOAD_LOG), { recursive: true });
    appendFileSync(LOAD_LOG, new Date().toISOString() + " " + message + "\n");
  } catch {
    // diagnostics must never break the plugin
  }
}

breadcrumb("module imported");

/**
 * Read an optional Cordis service without declaring it in `inject`: a profile
 * without the provider throws, and a missing service must never take the whole
 * plugin down (headless / tui profiles load this package too).
 */
function lookupService(scope, serviceName) {
  try {
    return typeof scope?.get === "function" ? scope.get(serviceName) : undefined;
  } catch {
    return undefined;
  }
}

export async function apply(ctx, config) {
  breadcrumb("apply start");
  const resolved = resolveConfig(config);
  const registry = new ProjectRegistry(resolved.threadsStorage.trim().length > 0 ? resolved.threadsStorage : defaultThreadsStorage());
  const store = new ProjectStore(resolved);
  // Set once any session actually received a grant, so a service reachable
  // from a session scope but not from this plugin's scope still counts.
  let sandboxSeen = false;
  const runtime = {
    config: resolved,
    store,
    registry,
    // Surfaced to the panel so a host without the sandbox service says so
    // instead of showing folder chips that core tools cannot actually use.
    sandboxAvailable: () => sandboxSeen || lookupService(ctx, "sandboxPolicy") !== undefined,
    // The storage-domain facility (see src/mainfolder.js): a main-folder switch
    // must go through the domain handle dsh-threads and DSH already opened, or the
    // next write from either of them overwrites it. Absent => file fallback.
    storageDomain: () => lookupService(ctx, "storageDomain")
  };

  // Panel preferences (this plugin's own file, never dsh-threads' storage). The
  // two behaviour switches start from the profile's config values, so a profile
  // that pinned them keeps its behaviour until someone flips the panel toggle.
  const settingsDefaults = {
    showResolvedThreads: resolved.hideResolvedThreads !== true,
    autoConvergeReports: resolved.autoConvergeReports === true
  };
  let preferences = await loadSettings(store, settingsDefaults);
  /** Read once per use: a route write must be visible to the very next snapshot. */
  const currentPreferences = () => preferences;

  const warn = (message) => {
    try {
      ctx.logger?.warn?.("dsh-claude-project-ui: " + message);
    } catch {
      // never let logging break the host
    }
  };
  const info = (message) => {
    try {
      ctx.logger?.info?.("dsh-claude-project-ui: " + message);
    } catch {
      // ignore
    }
  };

  // ---- browser half: read-only JSON the board panel fetches ----
  // Registered on the web server when this profile has one (the web GUI does).
  // Optional on purpose: headless / tui profiles load this plugin too.
  const BOARD_ROUTE = "/project-hub/board";
  const FOLDERS_ROUTE = "/project-hub/folders";
  const SETTINGS_ROUTE = "/project-hub/settings";
  const readBody = (req) =>
    new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on("data", (chunk) => {
        size += chunk.length;
        if (size > 1_000_000) {
          reject(new Error("body too large"));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      req.on("error", reject);
    });

  const workspaceFile = () =>
    resolved.workspaceStorage.trim().length > 0 ? resolved.workspaceStorage : defaultWorkspaceStorage(registry.path);
  /** The whole panel's data, plus which project the requesting session belongs to. */
  const boardSnapshot = async (sessionId) => {
    const projects = await registry.projects();
    const out = [];
    for (const project of projects) {
      const threads = await registry.threadsOf(project.id);
      const board = await loadBoard(store, project.id);
      const folders = await loadFolders(store, project.id);
      const view = boardView(project, threads, board, { all: currentPreferences().showResolvedThreads === true });
      out.push({
        id: project.id,
        title: project.title,
        folder: project.folder,
        // Which workspace record places this project's new sessions; the
        // settings page pairs the two and refuses to edit them apart.
        workspaceId: project.workspaceId,
        // Newest of the project record and its threads: the panel's ordering key
        // and its "last active" label read this one value.
        activity: projectActivity(project, threads),
        // Ours (this plugin's record), and theirs (present only when the
        // installed dsh-threads has the upstream folder feature).
        extraFolders: folders.folders,
        upstreamFolders: project.extraFolders ?? [],
        hidden: view.hidden,
        threads: view.threads.map((thread) => ({
          n: thread.n,
          title: thread.title,
          state: thread.state,
          code: thread.code,
          branch: thread.branch
        })),
        tasks: view.tasks
      });
    }
    // "Current project" = the project the asking session belongs to. The panel
    // is not session-scoped, so it passes the session it was opened next to; an
    // unknown or absent id simply yields no current card.
    let currentProjectId = null;
    const asking = typeof sessionId === "string" ? sessionId.trim() : "";
    if (asking.length > 0) {
      try {
        currentProjectId = (await registry.roleOf(asking)).project?.id ?? null;
      } catch (error) {
        warn("cannot resolve the asking session " + asking + ": " + String(error));
      }
    }
    const workspaces = workspaceRows(
      await listWorkspaces(workspaceFile()),
      out.map((project) => ({ ...project, extraFolderCount: project.extraFolders.length }))
    );
    return {
      projects: out,
      workspaces,
      currentProjectId,
      // The panel renders itself from these, so a toggle takes effect on the very
      // next snapshot without a restart.
      settings: currentPreferences(),
      sandbox: { available: runtime.sandboxAvailable() }
    };
  };

  try {
    const webServer = ctx.webServer;
    if (webServer !== undefined && webServer !== null && typeof webServer.register === "function") {
      const off = webServer.register({
        kind: "exact",
        path: BOARD_ROUTE,
        handler: async (req, res) => {
          try {
            // The panel posts the session it is open next to, so the snapshot can
            // mark that session's project as the current one. A GET or a body
            // without a session id is valid too: there is simply no current card.
            let sessionId = "";
            if (req.method !== "GET") {
              const raw = await readBody(req);
              if (raw.trim().length > 0) {
                try {
                  const body = JSON.parse(raw);
                  if (typeof body?.sessionId === "string") sessionId = body.sessionId;
                } catch {
                  // a malformed body is not worth failing the whole panel over
                }
              }
            }
            const snapshot = await boardSnapshot(sessionId);
            res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
            res.end(JSON.stringify({ ok: true, ...snapshot }));
          } catch (error) {
            res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
            res.end(JSON.stringify({ ok: false, error: String(error?.message ?? error) }));
          }
        }
      });
      if (typeof off === "function") ctx.effect?.(() => off, "dsh-claude-project-ui: board route");
      info("board panel route at " + BOARD_ROUTE);
      breadcrumb("route registered at " + BOARD_ROUTE);
    } else {
      breadcrumb("no webServer service on ctx");
    }
  } catch (error) {
    warn("cannot register the board route: " + String(error));
    breadcrumb("route failed: " + String(error));
  }

  // ---- mounts: add / remove an auxiliary folder (the panel's only write path) ----
  try {
    const webServer = ctx.webServer;
    if (webServer !== undefined && webServer !== null && typeof webServer.register === "function") {
      const off = webServer.register({
        kind: "exact",
        path: FOLDERS_ROUTE,
        handler: async (req, res) => {
          const reply = (status, payload) => {
            res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
            res.end(JSON.stringify(payload));
          };
          try {
            if (req.method !== "POST") return reply(405, { ok: false, error: "只支持 POST" });
            // A custom header makes this a non-simple request: a cross-site page
            // cannot send it without a CORS preflight this route never answers.
            if (req.headers["x-project-hub"] !== "1") {
              return reply(403, { ok: false, error: "缺少 x-project-hub 请求头" });
            }
            const raw = await readBody(req);
            const body = JSON.parse(raw.length > 0 ? raw : "{}");
            const action = String(body.action ?? "");
            // A bare workspace belongs to no project, so it is the one action that
            // does not need a project id; every other action edits one project.
            if (action === "workspace") {
              const workspaceId = typeof body.workspaceId === "string" ? body.workspaceId.trim() : "";
              if (workspaceId.length === 0) return reply(400, { ok: false, error: "缺少 workspaceId" });
              // A workspace a project owns is moved from the project row instead:
              // rewriting only the workspace would leave the project record pointing
              // at the old directory while new sessions open somewhere else.
              const owners = (await registry.projects()).filter((candidate) => candidate.workspaceId === workspaceId);
              if (owners.length > 0) {
                return reply(400, {
                  ok: false,
                  error:
                    "这个工作区属于项目「" + owners[0].title + "」：请在项目那一行改，两处记录要一起动，不能只改一边"
                });
              }
              const moved = await setWorkspaceFolder({
                facility: runtime.storageDomain(),
                workspacePath: workspaceFile(),
                workspaceId,
                folder: body.path,
                protectedTrees: [store.root]
              });
              return reply(200, {
                ok: true,
                workspaceId,
                folder: moved.folder,
                changed: moved.changed,
                before: moved.before,
                via: moved.via,
                backups: moved.backups,
                restartRequired: moved.restartRequired === true
              });
            }
            const projectId = typeof body.projectId === "string" ? body.projectId.trim() : "";
            const projects = await registry.projects();
            const project = projects.find((candidate) => candidate.id === projectId);
            if (project === undefined) return reply(404, { ok: false, error: "没有这个项目" });
            let state;
            if (action === "add") {
              state = await addFolder(store, project.id, {
                path: body.path,
                projectFolder: project.folder,
                max: resolved.maxExtraFolders
              });
            } else if (action === "remove") {
              state = await removeFolder(store, project.id, body.path);
            } else if (action === "main") {
              // Switch the project's MAIN folder: dsh-threads' project record plus the
              // DSH workspace record new sessions are placed from. The current
              // conversation keeps its directory — only a DSH restart moves new ones.
              const switched = await setMainFolder({
                facility: runtime.storageDomain(),
                threadsPath: registry.path,
                workspacePath: workspaceFile(),
                projectId: project.id,
                folder: body.path,
                protectedTrees: [store.root]
              });
              // Our panel reads dsh_threads.json directly: drop the cached parse so
              // the very next snapshot shows the value that is on disk now.
              registry.invalidate();
              return reply(200, {
                ok: true,
                projectId: project.id,
                folder: switched.folder,
                changed: switched.changed,
                before: switched.before,
                workspace: switched.workspace,
                via: switched.via,
                backups: switched.backups,
                restartRequired: switched.changed === true,
                extraFolders: (await loadFolders(store, project.id)).folders,
                sandbox: { available: runtime.sandboxAvailable() }
              });
            } else {
              return reply(400, { ok: false, error: "action 只能是 add / remove / main / workspace" });
            }
            // Re-register the sandbox grants of live sessions right away instead
            // of waiting for the next sweep.
            syncAll();
            reply(200, {
              ok: true,
              projectId: project.id,
              folder: project.folder,
              extraFolders: state.folders,
              sandbox: { available: runtime.sandboxAvailable() }
            });
          } catch (error) {
            reply(400, { ok: false, error: String(error?.message ?? error) });
          }
        }
      });
      if (typeof off === "function") ctx.effect?.(() => off, "dsh-claude-project-ui: folders route");
      info("folder mounts route at " + FOLDERS_ROUTE);
      breadcrumb("folders route registered at " + FOLDERS_ROUTE);
    }
  } catch (error) {
    warn("cannot register the folders route: " + String(error));
    breadcrumb("folders route failed: " + String(error));
  }


  // ---- panel preferences (the board's ⚙ settings) ----
  try {
    const webServer = ctx.webServer;
    if (webServer !== undefined && webServer !== null && typeof webServer.register === "function") {
      const off = webServer.register({
        kind: "exact",
        path: SETTINGS_ROUTE,
        handler: async (req, res) => {
          const reply = (status, payload) => {
            res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
            res.end(JSON.stringify(payload));
          };
          try {
            if (req.method !== "POST") return reply(405, { ok: false, error: "只支持 POST" });
            if (req.headers["x-project-hub"] !== "1") {
              return reply(403, { ok: false, error: "缺少 x-project-hub 请求头" });
            }
            const raw = await readBody(req);
            const body = JSON.parse(raw.length > 0 ? raw : "{}");
            // Accept both { patch: {...} } and a bare field object.
            const patch = body !== null && typeof body.patch === "object" && body.patch !== null ? body.patch : body;
            preferences = await saveSettings(store, patch, settingsDefaults);
            // Section text and grants follow the next sweep anyway; asking now makes
            // the injected board react to the same click.
            syncAll();
            reply(200, { ok: true, settings: preferences });
          } catch (error) {
            reply(400, { ok: false, error: String(error?.message ?? error) });
          }
        }
      });
      if (typeof off === "function") ctx.effect?.(() => off, "dsh-claude-project-ui: settings route");
      info("panel settings route at " + SETTINGS_ROUTE);
      breadcrumb("settings route registered at " + SETTINGS_ROUTE);
    }
  } catch (error) {
    warn("cannot register the settings route: " + String(error));
    breadcrumb("settings route failed: " + String(error));
  }

  /** sessionId -> { kb, board, digest, folders } prompt text, read synchronously by the host. */
  const textCache = new Map();
  /** agent -> disposer for its sections and tools. */
  const installed = new Map();
  /**
   * agent -> { key, available, granted, dispose } for the session's sandbox
   * grants. Runtime-only by design: the sandbox policy drops them on
   * resume/fork, so the sweep re-registers whenever the mount list changes.
   */
  const grants = new Map();

  async function refresh(sessionId) {
    let role;
    try {
      role = await registry.roleOf(sessionId);
    } catch (error) {
      warn("cannot read projects: " + String(error));
      return;
    }
    if (role.project === null) {
      textCache.delete(sessionId);
      return;
    }
    try {
      const threads = await registry.threadsOf(role.project.id);
      if (currentPreferences().autoConvergeReports === true) {
        await convergeThreads(store, role.project.id, threads).catch((error) =>
          warn("cannot converge thread reports: " + String(error))
        );
      }
      const [kb, board, digest, folders] = await Promise.all([
        loadKb(store, role.project.id),
        loadBoard(store, role.project.id),
        loadNotes(store, role.project.id),
        loadFolders(store, role.project.id)
      ]);
      const view = boardView(role.project, threads, board, { all: currentPreferences().showResolvedThreads === true });
      textCache.set(sessionId, {
        kb: kbSectionText(kbIndexText(kb, resolved.knowledgeIndexMaxChars, resolved.kbIndexMaxDocs), role.kind),
        folders: foldersSectionText(folders.folders, resolved.foldersContextMaxChars),
        board: boardSectionText(boardContextText(view, resolved.boardContextMaxChars), role.kind),
        digest: digestSectionText(digestText(eventsOf(threads, digest.notes), resolved.digestContextMaxChars), role.kind)
      });
    } catch (error) {
      warn("cannot refresh session " + sessionId + ": " + String(error));
    }
  }

  /**
   * Fill the prompt cache synchronously. A thread's first step is prepared right
   * after its session exists, so an async refresh would leave that step without
   * the board and progress sections.
   */
  function prime(sessionId, role) {
    if (role.project === null) return;
    try {
      const threads = registry.threadsOfSync(role.project.id);
      const kb = loadKbSync(store, role.project.id);
      const board = loadBoardSync(store, role.project.id);
      const digest = loadNotesSync(store, role.project.id);
      const folders = loadFoldersSync(store, role.project.id);
      const view = boardView(role.project, threads, board, { all: currentPreferences().showResolvedThreads === true });
      textCache.set(sessionId, {
        kb: kbSectionText(kbIndexText(kb, resolved.knowledgeIndexMaxChars, resolved.kbIndexMaxDocs), role.kind),
        folders: foldersSectionText(folders.folders, resolved.foldersContextMaxChars),
        board: boardSectionText(boardContextText(view, resolved.boardContextMaxChars), role.kind),
        digest: digestSectionText(digestText(eventsOf(threads, digest.notes), resolved.digestContextMaxChars), role.kind)
      });
    } catch (error) {
      warn("could not prime session " + sessionId + ": " + String(error));
    }
  }

  function install(agent, role) {
    if (installed.has(agent)) return;
    const sessionId = agent.id;
    if (role !== undefined) prime(sessionId, role);
    const disposers = [];
    try {
      const scope = agent.ctx;
      disposers.push(
        scope.systemPrompt.section({
          name: KB_SECTION,
          order: SECTION_ORDER,
          text: () => textCache.get(sessionId)?.kb ?? ""
        })
      );
      disposers.push(
        scope.systemPrompt.section({
          name: FOLDERS_SECTION,
          order: FOLDERS_ORDER,
          text: () => textCache.get(sessionId)?.folders ?? ""
        })
      );
      disposers.push(
        scope.systemPrompt.context({
          name: BOARD_CONTEXT,
          order: CONTEXT_ORDER,
          text: () => textCache.get(sessionId)?.board ?? ""
        })
      );
      disposers.push(
        scope.systemPrompt.context({
          name: DIGEST_CONTEXT,
          order: DIGEST_ORDER,
          text: () => textCache.get(sessionId)?.digest ?? ""
        })
      );
      for (const tool of createTools(runtime, sessionId, defineTool)) {
        disposers.push(scope.tools.register(tool));
      }
    } catch (error) {
      for (const dispose of disposers) {
        try {
          dispose?.();
        } catch {
          // ignore
        }
      }
      warn("could not install into session " + sessionId + ": " + String(error));
      installed.set(agent, () => {});
      return;
    }
    installed.set(agent, () => {
      for (const dispose of disposers) {
        try {
          dispose?.();
        } catch {
          // ignore
        }
      }
    });
  }

  /**
   * Keep one live session's extra writable roots equal to the project's mounts.
   * `registerWritableRoot` is a public DSH service method (dsh-sandbox-policy):
   * the grant is per session, runtime-only, and owned by the returned disposer.
   * Without the service we record `available: false` and grant nothing — the
   * panel says so instead of pretending the folders are writable.
   */
  function reconcileGrants(agent, project) {
    const folders = grantFolders(project.folder, loadFoldersSync(store, project.id).folders);
    const key = folders.join("\n");
    const current = grants.get(agent);
    if (current !== undefined && current.key === key) return;

    current?.dispose();
    const policy = lookupService(agent.ctx, "sandboxPolicy") ?? lookupService(ctx, "sandboxPolicy");
    if (policy === undefined || typeof policy.registerWritableRoot !== "function") {
      grants.set(agent, { key, available: false, granted: 0, dispose: () => {} });
      return;
    }
    sandboxSeen = true;
    if (agent.session === undefined || agent.session === null) {
      grants.set(agent, { key, available: true, granted: 0, dispose: () => {} });
      return;
    }
    const disposers = [];
    let granted = 0;
    for (const folder of folders) {
      try {
        const dispose = policy.registerWritableRoot(agent.session, folder);
        if (typeof dispose === "function") disposers.push(dispose);
        granted += 1;
      } catch (error) {
        warn("cannot grant " + folder + " to session " + agent.id + ": " + String(error?.message ?? error));
      }
    }
    grants.set(agent, {
      key,
      available: true,
      granted,
      dispose: () => {
        for (const dispose of disposers) {
          try {
            dispose?.();
          } catch {
            // ignore
          }
        }
      }
    });
  }

  function releaseGrants(agent) {
    grants.get(agent)?.dispose();
    grants.delete(agent);
  }

  async function sync(agent) {
    let role;
    try {
      role = await registry.roleOf(agent.id);
    } catch {
      return;
    }
    if (role.project === null) {
      releaseGrants(agent);
      return;
    }
    install(agent, role);
    reconcileGrants(agent, role.project);
    await refresh(agent.id);
  }

  const syncAll = () => {
    for (const agent of ctx.agents.list()) {
      void sync(agent).catch((error) => warn("sync failed: " + String(error)));
    }
  };

  syncAll();
  ctx.on("agent/created", ({ agent }) => {
    // Register before the first step is prepared: a new thread must see the board on step one.
    try {
      const role = registry.roleOfSync(agent.id);
      if (role.project !== null) {
        install(agent, role);
        reconcileGrants(agent, role.project);
      }
    } catch (error) {
      warn("sync install failed: " + String(error));
    }
    void sync(agent).catch((error) => warn("sync failed: " + String(error)));
  });
  let lastSweep = 0;
  ctx.on("agent/status", () => {
    const now = Date.now();
    if (now - lastSweep < 1500) return;
    lastSweep = now;
    syncAll();
  });
  ctx.on("agent/disposed", ({ agent }) => {
    installed.get(agent)?.();
    installed.delete(agent);
    releaseGrants(agent);
    textCache.delete(agent.id);
  });

  const timer = setInterval(syncAll, REFRESH_MS);
  ctx.effect(() => () => clearInterval(timer), "dsh-project-hub: refresh timer");

  ctx.effect(
    () => () => {
      for (const dispose of installed.values()) dispose();
      installed.clear();
      for (const grant of grants.values()) grant.dispose();
      grants.clear();
      textCache.clear();
    },
    "dsh-project-hub: sessions"
  );

  try {
    registerHubCommand(ctx, runtime, commandDefinitionId);
  } catch (error) {
    warn("could not register /hub: " + String(error));
  }

  info("ready; data in " + store.root);
  breadcrumb("apply done");
}

export { createTools };
