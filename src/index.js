import { resolveConfig } from "./config.js";
import { defaultThreadsStorage, ProjectRegistry } from "./project.js";
import { ProjectStore } from "./store.js";
import { createTools } from "./tools.js";
import { registerHubCommand } from "./command.js";
import {
  BOARD_CONTEXT,
  CONTEXT_ORDER,
  DIGEST_CONTEXT,
  DIGEST_ORDER,
  KB_SECTION,
  SECTION_ORDER,
  boardSectionText,
  digestSectionText,
  kbSectionText
} from "./prompts.js";
import { kbIndexText, loadKb, loadKbSync } from "./kb.js";
import { boardContextText, boardView, convergeThreads, loadBoard, loadBoardSync } from "./board.js";
import { digestText, eventsOf, loadNotes, loadNotesSync } from "./digest.js";

export const name = "dsh-project-hub";
export const inject = ["tools", "agents", "commands"];

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

export async function apply(ctx, config) {
  const resolved = resolveConfig(config);
  const registry = new ProjectRegistry(resolved.threadsStorage.trim().length > 0 ? resolved.threadsStorage : defaultThreadsStorage());
  const store = new ProjectStore(resolved);
  const runtime = { config: resolved, store, registry };

  const warn = (message) => {
    try {
      ctx.logger?.warn?.("dsh-project-hub: " + message);
    } catch {
      // never let logging break the host
    }
  };
  const info = (message) => {
    try {
      ctx.logger?.info?.("dsh-project-hub: " + message);
    } catch {
      // ignore
    }
  };

  // ---- browser half: read-only JSON the board panel fetches ----
  // Registered on the web server when this profile has one (the web GUI does).
  // Optional on purpose: headless / tui profiles load this plugin too.
  const BOARD_ROUTE = "/project-hub/board";
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

  const boardSnapshot = async () => {
    const projects = await registry.projects();
    const out = [];
    for (const project of projects) {
      const threads = await registry.threadsOf(project.id);
      const board = await loadBoard(store, project.id);
      const view = boardView(project, threads, board);
      out.push({
        id: project.id,
        title: project.title,
        folder: project.folder,
        hidden: view.hidden,
        threads: view.threads.map((thread) => ({
          n: thread.n,
          title: thread.title,
          state: thread.state,
          branch: thread.branch
        })),
        tasks: view.tasks
      });
    }
    return out;
  };

  try {
    const webServer =
      (typeof ctx.get === "function" ? ctx.get("webServer") : undefined) ?? ctx.webServer;
    if (webServer !== undefined && webServer !== null && typeof webServer.register === "function") {
      const off = webServer.register({
        kind: "exact",
        path: BOARD_ROUTE,
        handler: async (req, res) => {
          try {
            if (req.method !== "GET") await readBody(req);
            const projects = await boardSnapshot();
            res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
            res.end(JSON.stringify({ ok: true, projects }));
          } catch (error) {
            res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
            res.end(JSON.stringify({ ok: false, error: String(error?.message ?? error) }));
          }
        }
      });
      if (typeof off === "function") ctx.effect?.(() => off, "dsh-project-hub: board route");
      info("board panel route at " + BOARD_ROUTE);
    }
  } catch (error) {
    warn("cannot register the board route: " + String(error));
  }



  /** sessionId -> { kb, board, digest } prompt text, read synchronously by the host. */
  const textCache = new Map();
  /** agent -> disposer for its sections and tools. */
  const installed = new Map();

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
      if (resolved.autoConvergeReports === true) {
        await convergeThreads(store, role.project.id, threads).catch((error) =>
          warn("cannot converge thread reports: " + String(error))
        );
      }
      const [kb, board, digest] = await Promise.all([
        loadKb(store, role.project.id),
        loadBoard(store, role.project.id),
        loadNotes(store, role.project.id)
      ]);
      const view = boardView(role.project, threads, board, { all: resolved.hideResolvedThreads !== true });
      textCache.set(sessionId, {
        kb: kbSectionText(kbIndexText(kb, resolved.knowledgeIndexMaxChars, resolved.kbIndexMaxDocs), role.kind),
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
      const view = boardView(role.project, threads, board, { all: resolved.hideResolvedThreads !== true });
      textCache.set(sessionId, {
        kb: kbSectionText(kbIndexText(kb, resolved.knowledgeIndexMaxChars, resolved.kbIndexMaxDocs), role.kind),
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

  async function sync(agent) {
    let role;
    try {
      role = await registry.roleOf(agent.id);
    } catch {
      return;
    }
    if (role.project === null) return;
    install(agent, role);
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
      if (role.project !== null) install(agent, role);
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
    textCache.delete(agent.id);
  });

  const timer = setInterval(syncAll, REFRESH_MS);
  ctx.effect(() => () => clearInterval(timer), "dsh-project-hub: refresh timer");

  ctx.effect(
    () => () => {
      for (const dispose of installed.values()) dispose();
      installed.clear();
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
}

export { createTools };
