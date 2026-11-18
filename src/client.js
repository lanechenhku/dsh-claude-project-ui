// dsh-claude-project-ui — browser half.
//
// Four surfaces, one set of components and one write path:
//   1. the "项目看板 / Project board" tab in the right-hand sidebar pane,
//   2. a folder modal shared by every entry point below,
//   3. a "项目文件夹 / Project folders" section on the settings page,
//   4. a button injected into dsh-threads' own project-settings folder card.
//
// Data comes from POST /project-hub/board (read-only) and every write goes to
// POST /project-hub/folders, whose host half owns backup / realpath / serialising
// / rollback (src/mainfolder.js). Nothing here writes storage directly.
//
// The bundle is one self-contained file: the client module loader evaluates it as
// a script, so shared logic cannot be imported. Pure helpers therefore live here
// and are re-exported on the plugin object's __test surface for the harness.
window.__ModuleLoader__.load({
  id: "dsh-claude-project-ui",
  factory: (require) => {
    const React = require("react");
    const h = React.createElement;
    // react-dom is baseline in the web client (every portal user requires it), but
    // a bundle that cannot reach it must still mount: the dialog then renders in
    // place instead of disappearing.
    let ReactDOM = null;
    try {
      ReactDOM = require("react-dom");
    } catch (error) {
      ReactDOM = null;
    }

    // ---------- routes, slots, storage keys ----------
    const ROUTE = "/project-hub/board";
    const FOLDERS_ROUTE = "/project-hub/folders";
    const SETTINGS_ROUTE = "/project-hub/settings";
    const TAB_ID = "project-hub";
    const TAB_KIND = "project-hub";
    const TAB_ICON = "▤";
    const SETTINGS_SECTION_ID = "project-folders";
    /** Marks a button this plugin injected into foreign DOM; also the idempotency check. */
    const INJECT_ATTR = "data-project-hub-more";
    /** Locale namespace registered with the DSH locale service. */
    const NS = "project-hub";
    /** The dialog's container on document.body: outside every stacking context. */
    const DIALOG_ROOT_ID = "project-hub-dialog-root";
    /** Id of the dialog's accessible name node. */
    const DIALOG_TITLE_ID = "project-hub-dialog-title";

    function warn(message, error) {
      try {
        console.warn("dsh-claude-project-ui: " + message, error === undefined ? "" : error);
      } catch {
        // a console that throws must not take the panel down
      }
    }

    // ---------- i18n ----------
    // Every string the two surfaces (panel + dialog + settings page + the injected
    // button) show lives in these two tables. Zeros copies in the components.
    // The DSH locale service (dsh-client-locale) is the source of the active
    // language; a browser without it falls back to <html lang> / navigator.
    const MESSAGES = {
      zh: {
        "tab.title": "项目看板",
        "tab.description": "项目、讨论串与任务的一览",
        "board.open": "打开项目看板",
        "board.refresh": "刷新",
        "board.loading": "读取中…",
        "board.failed": "读取失败：{error}",
        "board.empty": "还没有 dsh-threads 项目",
        "board.section.others": "其他项目 · {count}",
        "board.section.all": "项目 · {count}",
        "board.expand": "展开",
        "board.collapse": "收起",
        "board.hidden": "另有 {count} 个已解决 / 已归档的讨论串",
        "card.threads": "{count} 个讨论串",
        "card.tasks": "{count} 个任务",
        "card.activity": "最近活动 {time}",
        "threads.title": "讨论串（{count}）",
        "threads.empty": "没有进行中的讨论串",
        "tasks.title": "任务（{count}）",
        "tasks.empty": "还没有任务",
        "tasks.copy": "复制任务号（/hub done {id}）",
        "tasks.copied": "已复制",
        "thread.running": "进行中",
        "thread.starting": "启动中",
        "thread.idle": "空闲",
        "thread.blocked": "受阻",
        "thread.waiting": "待决策",
        "thread.failed": "失败",
        "thread.stopped": "已停止",
        "thread.resolved": "已解决",
        "thread.unknown": "未知",
        "status.pending": "待办",
        "status.doing": "进行中",
        "status.blocked": "受阻",
        "status.done": "已完成",
        "time.justNow": "刚刚",
        "time.minutes": "{count} 分钟前",
        "time.hours": "{count} 小时前",
        "time.days": "{count} 天前",
        "time.never": "没有活动记录",
        "dialog.currentMain": "当前主文件夹",
        "dialog.change": "更换…",
        "dialog.choosing": "选择中…",
        "dialog.manualLink": "手动输入路径",
        "dialog.confirm": "确定",
        "dialog.cancel": "取消",
        "dialog.close": "关闭",
        "dialog.pathPlaceholder": "绝对路径，或 ~/ 开头",
        "dialog.addPlaceholder": "绝对路径，或 ~/开头",
        "dialog.aux": "辅助文件夹",
        "dialog.auxEmpty": "还没有辅助文件夹",
        "dialog.add": "添加",
        "dialog.remove": "移除",
        "dialog.saved": "已保存",
        "dialog.unchanged": "已经是这个目录",
        "dialog.failed": "操作失败：{error}",
        "dialog.viaFile": "⚠ 直接写了存储文件（宿主没有 storageDomain），重启前请再确认一次",
        "dialog.pickUnavailable": "这个环境没有文件夹选择器，请手填路径",
        "dialog.pickFailed": "没能打开文件夹选择器：{error}",
        "dialog.upstream": "dsh-threads 自己挂载的：{list}",
        "dialog.footnote": "辅助文件夹会登记为每个会话的沙箱可写根；改动写入 dsh-threads 记录，其设置面板重启后同步。",
        "dialog.footnoteNoSandbox": "宿主没有 sandboxPolicy：这些挂载目前只对本插件的工具生效。",
        "dialog.footnoteWorkspace": "改动写入 DSH 的 workspace 记录；新会话在重启后才用新目录。",
        "folders.unknown": "（未知）",
        "panel.title": "看板设置",
        "panel.language": "语言",
        "panel.languageAuto": "跟随应用（{lang}）",
        "panel.showResolved": "显示已解决 / 已归档的讨论串",
        "panel.converge": "自动把讨论串回报汇总成任务",
        "panel.otherCards": "「其他项目」卡片",
        "panel.collapsed": "默认折叠",
        "panel.expanded": "默认展开",
        "panel.sort": "排序",
        "panel.sortActivity": "最近活动",
        "panel.sortTitle": "名称",
        "panel.manage": "项目文件夹管理…",
        "panel.manageBack": "返回设置",
        "panel.failed": "保存失败：{error}",
        "panel.close": "关闭",
        "lang.zh": "中文",
        "lang.en": "English",
        "settings.nav": "项目文件夹",
        "settings.title": "项目文件夹",
        "settings.intro": "逐行修改：没有「批量改全部」。项目行会同时改项目记录与工作区记录。",
        "settings.projects": "项目（{count}）",
        "settings.workspaces": "工作区（{count}）",
        "settings.modify": "修改",
        "settings.auxCount": "辅助文件夹 {count} 个",
        "settings.sessions": "{count} 个会话",
        "settings.owned": "由项目「{title}」管理：请在项目那一行改",
        "settings.unowned": "没有项目使用这个工作区",
        "settings.missingWorkspace": "没有对应的 workspace 记录，新会话的目录无法改",
        "settings.empty": "还没有项目或工作区",
        "settings.loading": "读取中…",
        "settings.failed": "读取失败：{error}",
        "settings.footnote": "改动写入 dsh-threads 记录，其设置面板重启后同步。",
        "threads.more": "⚙ 更多文件夹⋯"
      },
      en: {
        "tab.title": "Project board",
        "tab.description": "One page for projects, threads and tasks",
        "board.open": "Open the project board",
        "board.refresh": "Refresh",
        "board.loading": "Loading…",
        "board.failed": "Could not load: {error}",
        "board.empty": "No dsh-threads projects yet",
        "board.section.others": "Other projects · {count}",
        "board.section.all": "Projects · {count}",
        "board.expand": "Expand",
        "board.collapse": "Collapse",
        "board.hidden": "{count} more threads are resolved or archived",
        "card.threads": "{count} threads",
        "card.tasks": "{count} tasks",
        "card.activity": "last active {time}",
        "threads.title": "Threads ({count})",
        "threads.empty": "No open threads",
        "tasks.title": "Tasks ({count})",
        "tasks.empty": "No tasks yet",
        "tasks.copy": "Copy the task id (/hub done {id})",
        "tasks.copied": "Copied",
        "thread.running": "Running",
        "thread.starting": "Starting",
        "thread.idle": "Idle",
        "thread.blocked": "Blocked",
        "thread.waiting": "Needs a decision",
        "thread.failed": "Failed",
        "thread.stopped": "Stopped",
        "thread.resolved": "Resolved",
        "thread.unknown": "Unknown",
        "status.pending": "To do",
        "status.doing": "In progress",
        "status.blocked": "Blocked",
        "status.done": "Done",
        "time.justNow": "just now",
        "time.minutes": "{count} min ago",
        "time.hours": "{count} h ago",
        "time.days": "{count} d ago",
        "time.never": "no activity recorded",
        "dialog.currentMain": "Current main folder",
        "dialog.change": "Change…",
        "dialog.choosing": "Choosing…",
        "dialog.manualLink": "Type a path",
        "dialog.confirm": "Set",
        "dialog.cancel": "Cancel",
        "dialog.close": "Close",
        "dialog.pathPlaceholder": "Absolute path, or ~/…",
        "dialog.addPlaceholder": "Absolute path, or ~/…",
        "dialog.aux": "Auxiliary folders",
        "dialog.auxEmpty": "No auxiliary folders yet",
        "dialog.add": "Add",
        "dialog.remove": "Remove",
        "dialog.saved": "Saved",
        "dialog.unchanged": "Already this folder",
        "dialog.failed": "Failed: {error}",
        "dialog.viaFile": "⚠ Wrote the storage files directly (no storageDomain service); check again before restarting",
        "dialog.pickUnavailable": "This environment has no folder chooser; type a path",
        "dialog.pickFailed": "Could not open the folder chooser: {error}",
        "dialog.upstream": "Mounted by dsh-threads itself: {list}",
        "dialog.footnote": "Auxiliary folders become writable sandbox roots for every session; changes are written to dsh-threads records, whose settings panel syncs after a restart.",
        "dialog.footnoteNoSandbox": "The host exposes no sandboxPolicy, so these mounts only work with this plugin own tools.",
        "dialog.footnoteWorkspace": "Changes are written to the DSH workspace record; new sessions use the new folder after a restart.",
        "folders.unknown": "(unknown)",
        "panel.title": "Board settings",
        "panel.language": "Language",
        "panel.languageAuto": "Follow app ({lang})",
        "panel.showResolved": "Show resolved and archived threads",
        "panel.converge": "Roll thread reports into tasks",
        "panel.otherCards": "'Other projects' cards",
        "panel.collapsed": "Collapsed",
        "panel.expanded": "Expanded",
        "panel.sort": "Sort",
        "panel.sortActivity": "Last active",
        "panel.sortTitle": "Name",
        "panel.manage": "Manage project folders…",
        "panel.manageBack": "Back",
        "panel.failed": "Could not save: {error}",
        "panel.close": "Close",
        "lang.zh": "中文",
        "lang.en": "English",
        "settings.nav": "Project folders",
        "settings.title": "Project folders",
        "settings.intro": "One row at a time: there is no 'change everything'. A project row moves the project record and the workspace record together.",
        "settings.projects": "Projects ({count})",
        "settings.workspaces": "Workspaces ({count})",
        "settings.modify": "Change",
        "settings.auxCount": "{count} auxiliary folders",
        "settings.sessions": "{count} sessions",
        "settings.owned": "Owned by project '{title}': change it from the project row",
        "settings.unowned": "No project uses this workspace",
        "settings.missingWorkspace": "No workspace record, so a new session directory cannot be moved",
        "settings.empty": "No projects or workspaces yet",
        "settings.loading": "Loading…",
        "settings.failed": "Could not load: {error}",
        "settings.footnote": "Changes are written to dsh-threads records; its settings panel syncs after a restart.",
        "threads.more": "⚙ More folders…"
      }
    };

    /** Which table a language tag resolves to. Anything not Chinese is English. */
    function normalizeLang(tag) {
      return String(tag ?? "").toLowerCase().startsWith("zh") ? "zh" : "en";
    }

    /**
     * Translate one key.
     *
     * Lookup order: the active language, then English, then Chinese, then the key
     * itself. English is the guaranteed fallback, so a key added to only one table
     * still renders readable copy instead of a raw identifier.
     */
    function translate(lang, key, vars) {
      const name = String(key ?? "");
      const active = MESSAGES[normalizeLang(lang)] || MESSAGES.en;
      let text = active[name];
      if (text === undefined) text = MESSAGES.en[name];
      if (text === undefined) text = MESSAGES.zh[name];
      if (text === undefined) return name;
      for (const [field, value] of Object.entries(vars || {})) {
        text = text.split("{" + field + "}").join(String(value));
      }
      return text;
    }

    // ---------- language store ----------
    // One tiny external store drives every hook below, so a language switch
    // re-renders the panel, the dialog and the settings page without a reload.
    const LANG_OVERRIDES = new Set(["auto", "zh", "en"]);

    function normalizeOverride(value) {
      const text = String(value ?? "auto");
      return LANG_OVERRIDES.has(text) ? text : "auto";
    }

    /**
     * Which language the panel renders.
     *
     * Priority: an explicit choice in the board settings ("zh" / "en") beats the
     * application language reported by the DSH locale service, which beats the
     * page's own <html lang> / navigator, which beats English. "auto" means the
     * panel has no opinion and must follow the application.
     */
    function resolveLanguage(options) {
      const settings = options !== null && typeof options === "object" ? options : {};
      const override = normalizeOverride(settings.override);
      if (override === "zh" || override === "en") return override;
      const app = String(settings.appLang ?? "").toLowerCase();
      if (app.startsWith("zh")) return "zh";
      if (app.startsWith("en")) return "en";
      const page = String(settings.pageLang ?? "").toLowerCase();
      if (page.startsWith("zh")) return "zh";
      if (page.startsWith("en")) return "en";
      return "en";
    }

    const langStore = {
      snapshot: { app: null, override: "auto", lang: resolveLanguage({ override: "auto", appLang: detectLang() }) },
      listeners: new Set(),
      subscribe(listener) {
        langStore.listeners.add(listener);
        return () => {
          langStore.listeners.delete(listener);
        };
      },
      getSnapshot() {
        return langStore.snapshot;
      },
      /** Recompute from whatever moved; the snapshot identity only moves on a real change. */
      update(patch) {
        const previous = langStore.snapshot;
        const app = patch !== null && typeof patch === "object" && Object.hasOwn(patch, "app") ? patch.app : previous.app;
        const override = patch !== null && typeof patch === "object" && Object.hasOwn(patch, "override") ? normalizeOverride(patch.override) : previous.override;
        const lang = resolveLanguage({
          override,
          appLang: app === null || app === undefined ? detectLang() : app,
          pageLang: detectLang()
        });
        if (previous.app === app && previous.override === override && previous.lang === lang) return;
        langStore.snapshot = { app, override, lang };
        for (const listener of [...langStore.listeners]) {
          try {
            listener();
          } catch (error) {
            warn("language listener failed", error);
          }
        }
      },
      /** The application language, from the DSH locale service. */
      setApp(lang) {
        langStore.update({ app: normalizeLang(lang) });
      },
      /** The panel's own language choice: "auto" follows the application. */
      setOverride(value) {
        langStore.update({ override: value });
      }
    };

    /** The page's own language, used until the locale service reports one. */
    function detectLang() {
      try {
        const tag =
          String((typeof document !== "undefined" && document.documentElement && document.documentElement.lang) || "") ||
          String((typeof navigator !== "undefined" && navigator.language) || "");
        if (tag.length > 0) return normalizeLang(tag);
      } catch {
        // no document: fall through
      }
      return "en";
    }

    function currentLang() {
      const lang = langStore.snapshot.lang;
      return lang !== null && lang !== undefined ? lang : detectLang();
    }

    /** useSyncExternalStore where available, useState + effect otherwise. */
    function useStore(subscribe, getSnapshot) {
      if (typeof React.useSyncExternalStore === "function") {
        return React.useSyncExternalStore(subscribe, getSnapshot);
      }
      const [value, setValue] = React.useState(getSnapshot);
      React.useEffect(() => {
        const off = subscribe(() => setValue(getSnapshot()));
        setValue(getSnapshot());
        return off;
      }, []);
      return value;
    }

    function useLang() {
      const snapshot = useStore(langStore.subscribe, langStore.getSnapshot);
      return snapshot.lang !== null && snapshot.lang !== undefined ? snapshot.lang : detectLang();
    }

    /** A translate function bound to the currently rendered language. */
    function useT() {
      const lang = useLang();
      return React.useCallback((key, vars) => translate(lang, key, vars), [lang]);
    }

    // ---------- formatting and ordering (pure, exported for the harness) ----------

    /** Status dot colours; 6px dots, readable on light and dark canvases. */
    const TONE = {
      doing: "#4C8DFF",
      pending: "#9AA0A6",
      blocked: "#E08A2E",
      done: "#3FAE6A",
      running: "#4C8DFF",
      starting: "#4C8DFF",
      waiting: "#E08A2E",
      failed: "#E08A2E",
      idle: "#C6C9CD",
      stopped: "#C6C9CD",
      resolved: "#3FAE6A",
      unknown: "#C6C9CD"
    };

    const THREAD_CODES = new Set(["running", "starting", "idle", "blocked", "waiting", "failed", "stopped", "resolved", "unknown"]);
    const TASK_STATUSES = new Set(["pending", "doing", "blocked", "done"]);

    function threadCode(code) {
      return THREAD_CODES.has(String(code)) ? String(code) : "unknown";
    }

    function taskStatus(status) {
      return TASK_STATUSES.has(String(status)) ? String(status) : "pending";
    }

    /** Colour of a 6px status dot, by thread code or task status. */
    function toneOf(code) {
      return TONE[String(code)] ?? TONE.unknown;
    }

    /**
     * Current project first, then everything else by the chosen order.
     *
     * The current project is the one the asking session belongs to (resolved on
     * the host); when the host cannot name one, no card is promoted and the whole
     * list simply sorts.
     *
     * @param mode - "activity" (newest activity first, the default) or "title"
     *   (A→Z; ties break by activity so the order stays stable).
     */
    function sortProjects(projects, currentProjectId, mode) {
      const order = String(mode ?? "activity") === "title" ? "title" : "activity";
      const list = Array.isArray(projects) ? projects.slice() : [];
      let current = null;
      const others = [];
      for (const project of list) {
        if (project === null || typeof project !== "object") continue;
        if (currentProjectId !== null && currentProjectId !== undefined && project.id === currentProjectId && current === null) {
          current = project;
          continue;
        }
        others.push(project);
      }
      others.sort((a, b) => {
        const byActivity = String(b.activity ?? "").localeCompare(String(a.activity ?? ""));
        const byTitle = String(a.title ?? "").localeCompare(String(b.title ?? ""));
        if (order === "title") return byTitle !== 0 ? byTitle : byActivity;
        return byActivity !== 0 ? byActivity : byTitle;
      });
      return { current, others };
    }

    /** "3 min ago" / "3 分钟前"; older than a month prints the date. */
    function relativeTime(iso, lang, now) {
      const time = Date.parse(String(iso ?? ""));
      if (!Number.isFinite(time)) return translate(lang, "time.never");
      const elapsed = Math.max(0, (typeof now === "number" ? now : Date.now()) - time);
      const minutes = Math.floor(elapsed / 60000);
      if (minutes < 1) return translate(lang, "time.justNow");
      if (minutes < 60) return translate(lang, "time.minutes", { count: minutes });
      const hours = Math.floor(minutes / 60);
      if (hours < 24) return translate(lang, "time.hours", { count: hours });
      const days = Math.floor(hours / 24);
      if (days < 30) return translate(lang, "time.days", { count: days });
      const date = new Date(time);
      const month = String(date.getMonth() + 1).padStart(2, "0");
      const day = String(date.getDate()).padStart(2, "0");
      return date.getFullYear() + "-" + month + "-" + day;
    }

    /** Trailing slashes and stray whitespace do not make two paths different. */
    function normPath(path) {
      let text = String(path ?? "").trim();
      while (text.length > 1 && text.endsWith("/")) text = text.slice(0, -1);
      return text;
    }

    /** The project whose main folder is this path, by exact normalised spelling. */
    function findProjectByFolder(projects, path) {
      const target = normPath(path);
      if (target.length === 0) return null;
      for (const project of projects ?? []) {
        if (project !== null && typeof project === "object" && normPath(project.folder) === target) return project;
      }
      return null;
    }

    // ---------- host data ----------
    // One cache per asking session: the current project depends on which session
    // the panel was opened next to, so two tabs would otherwise fight over it.
    const boardCache = { key: "", at: 0, data: null, pending: null };

    function messageOf(error) {
      return String((error && error.message) || error);
    }

    function emptyBoard() {
      return { projects: [], workspaces: [], currentProjectId: null, sandbox: { available: false } };
    }

    /**
     * Read the panel's data. Read-only: the host route never writes.
     *
     * @param force - bypass the 5s cache.
     * @param sessionId - the conversation this panel is open next to; the host
     *   resolves it to a project so the board can promote that project.
     */
    function fetchBoard(force, sessionId) {
      const key = String(sessionId ?? "");
      if (!force && boardCache.data !== null && boardCache.key === key && Date.now() - boardCache.at < 5000) {
        return Promise.resolve(boardCache.data);
      }
      if (boardCache.pending !== null && boardCache.key === key) return boardCache.pending;
      boardCache.key = key;
      boardCache.pending = fetch(ROUTE, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: key })
      })
        .then((response) => response.json())
        .then((json) => {
          if (!json || json.ok !== true) throw new Error((json && json.error) || "board route returned nothing");
          const data = {
            projects: Array.isArray(json.projects) ? json.projects : [],
            workspaces: Array.isArray(json.workspaces) ? json.workspaces : [],
            currentProjectId: typeof json.currentProjectId === "string" ? json.currentProjectId : null,
            sandbox: json.sandbox && typeof json.sandbox === "object" ? json.sandbox : { available: false }
          };
          boardCache.data = data;
          boardCache.at = Date.now();
          // The host is the persisted truth for the panel's own preferences.
          settingsStore.adopt(json.settings);
          return data;
        })
        .finally(() => {
          boardCache.pending = null;
        });
      return boardCache.pending;
    }

    /**
     * The only write path: POST /project-hub/folders.
     *
     * action "main"      move a project's main folder (project + workspace records)
     * action "add"       mount an auxiliary folder of a project
     * action "remove"    unmount one
     * action "workspace" move a workspace no project owns
     */
    function postFolders(body) {
      return fetch(FOLDERS_ROUTE, {
        method: "POST",
        headers: { "content-type": "application/json", "x-project-hub": "1" },
        body: JSON.stringify(body)
      })
        .then((response) => response.json())
        .then((json) => {
          if (!json || json.ok !== true) throw new Error((json && json.error) || "folder route returned nothing");
          return json;
        });
    }

    /** Persist one preference change in this plugin's own settings file. */
    function postSettings(patch) {
      return fetch(SETTINGS_ROUTE, {
        method: "POST",
        headers: { "content-type": "application/json", "x-project-hub": "1" },
        body: JSON.stringify({ patch })
      })
        .then((response) => response.json())
        .then((json) => {
          if (!json || json.ok !== true) throw new Error((json && json.error) || "settings route returned nothing");
          return json;
        });
    }

    /**
     * The folder chooser DSH itself uses (dsh-client-ui-directory-picker-native):
     * Electron's dialog on Desktop through the global, the host's picker otherwise.
     * Resolves a path, null when the user cancels, or "unavailable".
     */
    async function pickFolder(service) {
      const desktop = typeof globalThis !== "undefined" ? globalThis.__DSH_DIRECTORY_PICKER__ : undefined;
      if (desktop && typeof desktop.pick === "function") return await desktop.pick();
      const workspace = service("uiWorkspace");
      if (workspace && typeof workspace.pickDirectory === "function") {
        try {
          return await workspace.pickDirectory();
        } catch (error) {
          if (/unavailab|not support|not implement|cannot/i.test(String(messageOf(error)))) return "unavailable";
          throw error;
        }
      }
      return "unavailable";
    }

    // The session whose conversation the panel is open next to. Session-scoped
    // slots (the header action) report it; without one the host simply has no
    // current project to promote.
    let lastSessionId = "";
    /** Read a client service without declaring it: a missing one returns undefined. */
    let service = () => undefined;

    // ---------- dialog store ----------
    // A and C share this one dialog: the board opens it from a React button, the
    // injected button in dsh-threads' DOM opens it from plain DOM code.
    const dialogStore = {
      snapshot: { open: false, kind: null, project: null, workspace: null, sandboxAvailable: false },
      listeners: new Set(),
      subscribe(listener) {
        dialogStore.listeners.add(listener);
        return () => {
          dialogStore.listeners.delete(listener);
        };
      },
      getSnapshot() {
        return dialogStore.snapshot;
      },
      emit() {
        for (const listener of [...dialogStore.listeners]) {
          try {
            listener();
          } catch (error) {
            warn("dialog listener failed", error);
          }
        }
      },
      showProject(project, options) {
        if (project === null || project === undefined) return;
        // One overlay at a time.
        panelStore.hide();
        const settings = options || {};
        dialogStore.snapshot = {
          open: true,
          kind: "project",
          project,
          workspace: null,
          sandboxAvailable: settings.sandboxAvailable === true
        };
        dialogStore.emit();
      },
      showWorkspace(workspace) {
        if (workspace === null || workspace === undefined) return;
        panelStore.hide();
        dialogStore.snapshot = { open: true, kind: "workspace", project: null, workspace, sandboxAvailable: false };
        dialogStore.emit();
      },
      hide() {
        if (!dialogStore.snapshot.open) return;
        dialogStore.snapshot = { open: false, kind: null, project: null, workspace: null, sandboxAvailable: false };
        dialogStore.emit();
      }
    };

    // ---------- panel settings ----------
    // The board's own preferences: language override, thread visibility, card
    // opening, sort order. Persisted by the host half in this plugin's data
    // directory (never in dsh-threads' storage); a change applies on the spot.
    const SETTINGS_DEFAULTS = {
      language: "auto",
      showResolvedThreads: false,
      autoConvergeReports: true,
      otherCardsExpanded: false,
      sort: "activity"
    };
    const CLIENT_LANGUAGES = new Set(["auto", "zh", "en"]);
    const CLIENT_SORTS = new Set(["activity", "title"]);

    function clientBool(value, fallback) {
      if (value === true || value === false) return value;
      if (value === "true") return true;
      if (value === "false") return false;
      return fallback;
    }

    /** The same normalisation the host applies, so both ends agree on the shape. */
    function normalizeClientSettings(raw) {
      const value = raw !== null && typeof raw === "object" ? raw : {};
      return {
        language: CLIENT_LANGUAGES.has(String(value.language)) ? String(value.language) : SETTINGS_DEFAULTS.language,
        showResolvedThreads: clientBool(value.showResolvedThreads, SETTINGS_DEFAULTS.showResolvedThreads),
        autoConvergeReports: clientBool(value.autoConvergeReports, SETTINGS_DEFAULTS.autoConvergeReports),
        otherCardsExpanded: clientBool(value.otherCardsExpanded, SETTINGS_DEFAULTS.otherCardsExpanded),
        sort: CLIENT_SORTS.has(String(value.sort)) ? String(value.sort) : SETTINGS_DEFAULTS.sort
      };
    }

    function sameSettings(a, b) {
      return (
        a.language === b.language &&
        a.showResolvedThreads === b.showResolvedThreads &&
        a.autoConvergeReports === b.autoConvergeReports &&
        a.otherCardsExpanded === b.otherCardsExpanded &&
        a.sort === b.sort
      );
    }

    function notifyAll(listeners, what) {
      for (const listener of [...listeners]) {
        try {
          listener();
        } catch (error) {
          warn(what + " listener failed", error);
        }
      }
    }

    const settingsStore = {
      snapshot: { ...SETTINGS_DEFAULTS, saving: false, error: null },
      listeners: new Set(),
      subscribe(listener) {
        settingsStore.listeners.add(listener);
        return () => {
          settingsStore.listeners.delete(listener);
        };
      },
      getSnapshot() {
        return settingsStore.snapshot;
      },
      /** Adopt what the host reports: it is the persisted truth. */
      adopt(settings) {
        if (settings === null || typeof settings !== "object") return;
        // A snapshot that was already in flight when a change was made describes
        // the previous state; the write itself is authoritative when it lands.
        if (settingsStore.snapshot.saving === true) return;
        const next = normalizeClientSettings(settings);
        if (sameSettings(next, settingsStore.snapshot)) return;
        settingsStore.snapshot = { ...settingsStore.snapshot, ...next };
        // The language choice applies the moment it is known, not on next reload.
        langStore.setOverride(next.language);
        notifyAll(settingsStore.listeners, "settings");
      },
      /**
       * Change one preference: render it immediately, then persist it. On a
       * failed write the previous value comes back and the row says why.
       */
      patch(partial) {
        const previous = normalizeClientSettings(settingsStore.snapshot);
        const next = normalizeClientSettings({ ...previous, ...(partial !== null && typeof partial === "object" ? partial : {}) });
        if (sameSettings(next, previous)) return Promise.resolve(next);
        settingsStore.snapshot = { ...settingsStore.snapshot, ...next, saving: true, error: null };
        langStore.setOverride(next.language);
        notifyAll(settingsStore.listeners, "settings");
        // A host without fetch must fail into the same revert path instead of
        // throwing out of the click handler.
        let pending;
        try {
          pending = postSettings(partial);
        } catch (failure) {
          pending = Promise.reject(failure);
        }
        return pending.then(
          (json) => {
            const saved = normalizeClientSettings(json.settings);
            settingsStore.snapshot = { ...settingsStore.snapshot, ...saved, saving: false, error: null };
            langStore.setOverride(saved.language);
            notifyAll(settingsStore.listeners, "settings");
            // The host fills the snapshot from these, so re-read it: hiding resolved
            // threads is a server-side filter, not a client-only one.
            invalidateBoard();
            return saved;
          },
          (failure) => {
            settingsStore.snapshot = { ...settingsStore.snapshot, ...previous, saving: false, error: messageOf(failure) };
            langStore.setOverride(previous.language);
            notifyAll(settingsStore.listeners, "settings");
            throw failure;
          }
        );
      }
    };

    function useSettings() {
      return useStore(settingsStore.subscribe, settingsStore.getSnapshot);
    }

    /** The board's ⚙ popover: closed, open at an anchor, or showing the manager. */
    const panelStore = {
      snapshot: { open: false, anchor: null, view: "settings" },
      listeners: new Set(),
      subscribe(listener) {
        panelStore.listeners.add(listener);
        return () => {
          panelStore.listeners.delete(listener);
        };
      },
      getSnapshot() {
        return panelStore.snapshot;
      },
      show(anchor, view) {
        // One overlay at a time: the folder dialog and this popover never share
        // the container.
        dialogStore.hide();
        panelStore.snapshot = { open: true, anchor: anchor ?? null, view: view === "manage" ? "manage" : "settings" };
        notifyAll(panelStore.listeners, "panel");
      },
      setView(view) {
        if (!panelStore.snapshot.open) return;
        const next = view === "manage" ? "manage" : "settings";
        if (panelStore.snapshot.view === next) return;
        panelStore.snapshot = { ...panelStore.snapshot, view: next };
        notifyAll(panelStore.listeners, "panel");
      },
      hide() {
        if (!panelStore.snapshot.open) return;
        panelStore.snapshot = { open: false, anchor: null, view: "settings" };
        notifyAll(panelStore.listeners, "panel");
      },
      toggle(anchor) {
        if (panelStore.snapshot.open) panelStore.hide();
        else panelStore.show(anchor);
      }
    };

    // ---------- design tokens ----------
    // 8px rhythm (4px half-step), radius 10, one hairline weight, hover wash and
    // a deliberately shadow-free surface: the panel must read in both themes.
    const SPACE = 8;
    const RADIUS = 10;
    const BORDER = "rgba(127,127,127,0.18)";
    const BORDER_STRONG = "rgba(127,127,127,0.26)";
    const HOVER = "rgba(127,127,127,0.06)";
    const ACCENT = "#4C8DFF";
    const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";
    const TEXT_FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

    const S = {
      root: { display: "flex", flexDirection: "column", height: "100%", minHeight: 0, font: "13px/1.55 " + TEXT_FONT },
      header: {
        display: "flex",
        alignItems: "center",
        gap: SPACE,
        padding: SPACE + "px 12px",
        borderBottom: "1px solid " + BORDER,
        flex: "0 0 auto"
      },
      title: { fontWeight: 600, fontSize: 13, flex: 1 },
      button: {
        border: "1px solid " + BORDER_STRONG,
        background: "transparent",
        color: "inherit",
        borderRadius: SPACE,
        padding: "4px " + SPACE + "px",
        fontSize: 12,
        lineHeight: 1.35,
        cursor: "pointer",
        whiteSpace: "nowrap"
      },
      buttonDisabled: {
        border: "1px solid " + BORDER,
        background: "transparent",
        color: "inherit",
        borderRadius: SPACE,
        padding: "4px " + SPACE + "px",
        fontSize: 12,
        opacity: 0.5,
        cursor: "not-allowed",
        whiteSpace: "nowrap"
      },
      ghost: {
        border: "none",
        background: "transparent",
        color: "inherit",
        padding: "0 4px",
        fontSize: 11,
        lineHeight: 1,
        cursor: "pointer",
        opacity: 0.6
      },
      body: { flex: "1 1 auto", minHeight: 0, overflowY: "auto", padding: SPACE + "px 12px 24px" },
      // current-project card: one hairline box, an accent rail, no shadow
      currentCard: {
        display: "flex",
        gap: 12,
        alignItems: "stretch",
        border: "1px solid " + BORDER,
        borderRadius: RADIUS,
        padding: 12,
        margin: "0 0 " + SPACE + "px"
      },
      accentRail: { flex: "0 0 3px", borderRadius: 2, background: ACCENT },
      cardColumn: { flex: "1 1 auto", minWidth: 0 },
      cardHead: { display: "flex", alignItems: "flex-start", gap: SPACE },
      cardTitleBox: { flex: "1 1 auto", minWidth: 0 },
      cardTitle: { fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
      path: { fontFamily: MONO, fontSize: 11, opacity: 0.55, marginTop: 2, wordBreak: "break-all" },
      meta: { display: "flex", flexWrap: "wrap", gap: SPACE, fontSize: 11, opacity: 0.5, marginTop: 4 },
      // sticky divider between the current project and everything else
      sectionBar: {
        position: "sticky",
        top: 0,
        zIndex: 3,
        display: "flex",
        alignItems: "center",
        gap: SPACE,
        margin: "12px 0 " + SPACE + "px",
        padding: "8px 0",
        borderTop: "2px solid " + BORDER_STRONG,
        background: "Canvas",
        fontFamily: TEXT_FONT
      },
      sectionLabel: { fontSize: 11, letterSpacing: "0.04em", fontWeight: 600, opacity: 0.55, textTransform: "uppercase" },
      sectionCount: { fontSize: 11, opacity: 0.4, marginLeft: "auto" },
      // other projects: hairline-separated rows, 12px rhythm, expandable
      // Secondary separation between cards: one hairline plus 12px of space,
      // so a scrolled list reads as a list and not as a stack of boxes.
      otherCard: { borderTop: "1px solid " + BORDER, paddingTop: 12 },
      otherCardFirst: { paddingTop: 0 },
      rowButton: {
        display: "flex",
        alignItems: "center",
        gap: SPACE,
        width: "100%",
        border: "none",
        background: "transparent",
        color: "inherit",
        borderRadius: SPACE,
        padding: "4px " + SPACE + "px",
        textAlign: "left",
        cursor: "pointer",
        font: "inherit"
      },
      row: { display: "flex", alignItems: "center", gap: SPACE, padding: "4px " + SPACE + "px", borderRadius: SPACE, fontSize: 12 },
      dot: { width: 6, height: 6, borderRadius: 3, flex: "0 0 6px" },
      threadN: { fontFamily: MONO, fontSize: 11, opacity: 0.5, flex: "0 0 auto" },
      threadTitle: { flex: "1 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
      stateWord: { fontSize: 11, opacity: 0.6, whiteSpace: "nowrap" },
      pill: {
        fontSize: 10,
        padding: "1px 6px",
        borderRadius: 999,
        border: "1px solid " + BORDER_STRONG,
        whiteSpace: "nowrap"
      },
      taskId: { fontFamily: MONO, fontSize: 11, opacity: 0.5, flex: "0 0 auto" },
      taskSubject: { flex: "1 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
      subLabel: { fontSize: 11, opacity: 0.5, margin: "12px 0 4px", letterSpacing: "0.02em" },
      emptyLine: { fontSize: 12, opacity: 0.42, padding: "2px " + SPACE + "px" },
      input: {
        flex: "1 1 auto",
        minWidth: 0,
        border: "1px solid " + BORDER_STRONG,
        background: "transparent",
        color: "inherit",
        borderRadius: SPACE,
        padding: "4px 8px",
        fontSize: 12,
        font: "inherit"
      },
      hint: { fontSize: 11, opacity: 0.5, lineHeight: 1.5, margin: "4px 0 0", padding: "0 " + SPACE + "px" },
      warn: { fontSize: 11, color: "#E08A2E", lineHeight: 1.5, margin: "4px 0 0", padding: "0 " + SPACE + "px" },
      error: { fontSize: 11, color: "#E86A6A", lineHeight: 1.5, margin: "4px 0 0", padding: "0 " + SPACE + "px" },
      // dialog: fixed overlay, opaque system canvas so it reads in either theme
      scrim: {
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "rgba(0,0,0,0.32)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16
      },
      modal: {
        width: "min(560px, 100%)",
        maxHeight: "calc(100vh - 64px)",
        overflowY: "auto",
        background: "Canvas",
        color: "CanvasText",
        border: "1px solid " + BORDER_STRONG,
        borderRadius: 12,
        padding: 16,
        font: "13px/1.55 " + TEXT_FONT
      },
      modalHead: { display: "flex", alignItems: "center", gap: SPACE, marginBottom: 12 },
      modalTitle: { fontSize: 13, fontWeight: 600, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
      // settings page rows
      settingsRoot: { display: "flex", flexDirection: "column", gap: 4, font: "13px/1.55 " + TEXT_FONT },
      settingsGroup: { marginTop: 12 },
      settingsRow: {
        display: "flex",
        alignItems: "flex-start",
        gap: 12,
        padding: "10px 0",
        borderTop: "1px solid " + BORDER
      },
      settingsRowMain: { flex: "1 1 auto", minWidth: 0 },
      settingsRowTitle: { fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
      settingsNote: { fontSize: 11, opacity: 0.5, marginTop: 2 },
      // ---- dialog (0.4.1): header / one action row / divider / aux list / footnote
      actionRow: { display: "flex", alignItems: "center", gap: SPACE, padding: "4px 0" },
      primary: {
        border: "1px solid transparent",
        background: ACCENT,
        color: "#FFFFFF",
        borderRadius: SPACE,
        padding: "4px " + SPACE + "px",
        fontSize: 12,
        lineHeight: 1.35,
        cursor: "pointer",
        whiteSpace: "nowrap"
      },
      primaryDisabled: {
        border: "1px solid transparent",
        background: ACCENT,
        color: "#FFFFFF",
        borderRadius: SPACE,
        padding: "4px " + SPACE + "px",
        fontSize: 12,
        lineHeight: 1.35,
        opacity: 0.5,
        cursor: "not-allowed",
        whiteSpace: "nowrap"
      },
      link: {
        border: "none",
        background: "transparent",
        color: "inherit",
        padding: 0,
        fontSize: 12,
        lineHeight: 1.4,
        opacity: 0.6,
        textDecoration: "underline",
        cursor: "pointer",
        whiteSpace: "nowrap"
      },
      divider: { borderTop: "1px solid " + BORDER, margin: "12px 0" },
      sectionHead: { display: "flex", alignItems: "center", gap: SPACE, marginBottom: 4 },
      sectionHeadTitle: { fontSize: 12, fontWeight: 600 },
      badge: {
        fontSize: 10,
        lineHeight: 1.3,
        padding: "0 6px",
        borderRadius: 999,
        border: "1px solid " + BORDER_STRONG,
        opacity: 0.7
      },
      folderRow: { display: "flex", alignItems: "center", gap: SPACE, padding: "4px 0" },
      folderPath: {
        flex: "1 1 auto",
        minWidth: 0,
        fontFamily: MONO,
        fontSize: 11,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap"
      },
      footnote: { fontSize: 11, opacity: 0.45, lineHeight: 1.5, marginTop: 12 },
      faint: { fontSize: 11, opacity: 0.5, lineHeight: 1.5, marginTop: 4 },
      savedChip: { fontSize: 11, color: "#3FAE6A", marginLeft: "auto", whiteSpace: "nowrap" },
      modalOverline: { fontSize: 11, opacity: 0.45, marginTop: 8 },
      modalPath: {
        fontFamily: MONO,
        fontSize: 11,
        opacity: 0.7,
        marginTop: 2,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap"
      },
      closeButton: {
        border: "none",
        background: "transparent",
        color: "inherit",
        padding: 4,
        fontSize: 13,
        lineHeight: 1,
        cursor: "pointer",
        opacity: 0.55,
        flex: "0 0 auto"
      },
      // ---- board settings popover (anchored under the ⚙ button)
      panelScrim: { position: "fixed", inset: 0, zIndex: 9998, background: "transparent" },
      panel: {
        position: "fixed",
        zIndex: 9999,
        background: "Canvas",
        color: "CanvasText",
        border: "1px solid " + BORDER_STRONG,
        borderRadius: 12,
        padding: 12,
        overflowY: "auto",
        font: "13px/1.55 " + TEXT_FONT
      },
      panelHead: { display: "flex", alignItems: "center", gap: SPACE, marginBottom: SPACE },
      panelTitle: { fontSize: 12, fontWeight: 600, flex: "1 1 auto" },
      settingRow: { display: "flex", alignItems: "center", gap: SPACE, minHeight: 32, padding: "2px 0" },
      settingLabel: { flex: "1 1 auto", minWidth: 0, fontSize: 12 },
      segmented: { display: "flex", alignItems: "center", gap: 4, flex: "0 0 auto" },
      segment: {
        border: "1px solid " + BORDER,
        background: "transparent",
        color: "inherit",
        borderRadius: 6,
        padding: "2px 6px",
        fontSize: 11,
        lineHeight: 1.4,
        cursor: "pointer",
        whiteSpace: "nowrap",
        opacity: 0.75
      },
      segmentActive: { borderColor: ACCENT, color: ACCENT, opacity: 1 },
      switchTrack: {
        position: "relative",
        width: 28,
        height: 16,
        borderRadius: 999,
        border: "1px solid " + BORDER_STRONG,
        background: "transparent",
        color: "inherit",
        padding: 0,
        cursor: "pointer",
        flex: "0 0 auto"
      },
      switchTrackOn: { background: ACCENT, borderColor: ACCENT },
      switchKnob: {
        position: "absolute",
        top: 2,
        left: 2,
        width: 10,
        height: 10,
        borderRadius: 999,
        background: "currentColor",
        opacity: 0.8
      },
      switchKnobOn: { left: 14, background: "#FFFFFF", opacity: 1 },
      panelError: { fontSize: 11, color: "#E86A6A", marginTop: 4, lineHeight: 1.5 }
    };

    /** Hover wash for rows that are clickable, without a stylesheet. */
    function useHoverStyle(base) {
      const [hover, setHover] = React.useState(false);
      const style = hover ? { ...base, background: HOVER } : base;
      return [style, { onMouseEnter: () => setHover(true), onMouseLeave: () => setHover(false) }];
    }

    // ---------- board invalidation ----------
    // One bus: every surface (board, settings page, dialog) reloads after a write.
    const boardListeners = new Set();

    function subscribeBoard(listener) {
      boardListeners.add(listener);
      return () => {
        boardListeners.delete(listener);
      };
    }

    function invalidateBoard() {
      boardCache.at = 0;
      boardCache.data = null;
      for (const listener of [...boardListeners]) {
        try {
          listener();
        } catch (error) {
          warn("board listener failed", error);
        }
      }
    }

    /** Shared board subscription for the tab and the settings section. */
    function useBoard() {
      const [state, setState] = React.useState({ loading: true, error: null, data: null });
      const load = React.useCallback((force) => {
        fetchBoard(force === true, lastSessionId).then(
          (data) => setState({ loading: false, error: null, data }),
          (error) => setState((previous) => ({ loading: false, error: messageOf(error), data: previous.data }))
        );
      }, []);
      React.useEffect(() => {
        load(true);
        return subscribeBoard(() => load(true));
      }, [load]);
      return {
        loading: state.loading,
        error: state.error,
        data: state.data === null ? emptyBoard() : state.data,
        refresh: () => load(true)
      };
    }

    // ---------- shared folder logic ----------

    /** 6px state dot; the colour is the only status signal on a thread row. */
    function StatusDot(props) {
      return h("span", { "aria-hidden": "true", style: { ...S.dot, background: toneOf(props.code) } });
    }

    function ThreadRow(props) {
      const thread = props.thread;
      const t = props.t;
      const code = threadCode(thread.code);
      return h(
        "div",
        { style: S.row },
        h(StatusDot, { code }),
        h("span", { style: S.threadN }, "#" + thread.n),
        h("span", { style: S.threadTitle, title: thread.title || "" }, thread.title || ""),
        h("span", { style: S.stateWord }, t("thread." + code))
      );
    }

    function TaskRow(props) {
      const task = props.task;
      const t = props.t;
      const status = taskStatus(task.status);
      const [copied, setCopied] = React.useState(false);
      React.useEffect(() => {
        if (!copied) return undefined;
        const timer = setTimeout(() => setCopied(false), 1200);
        return () => clearTimeout(timer);
      }, [copied]);
      const copy = () => {
        try {
          const clipboard = typeof navigator !== "undefined" ? navigator.clipboard : undefined;
          if (clipboard && typeof clipboard.writeText === "function") {
            clipboard.writeText(String(task.id)).then(() => setCopied(true), () => setCopied(false));
            return;
          }
        } catch (error) {
          warn("clipboard unavailable", error);
        }
        setCopied(false);
      };
      return h(
        "div",
        { style: S.row },
        h("span", { style: S.pill }, t("status." + status)),
        h("span", { style: S.taskId, title: String(task.id) }, String(task.id)),
        h("span", { style: S.taskSubject, title: task.subject || "" }, task.subject || ""),
        h(
          "button",
          {
            type: "button",
            style: S.ghost,
            title: t("tasks.copy", { id: String(task.id) }),
            onClick: copy
          },
          copied ? t("tasks.copied") : "+"
        )
      );
    }

    /**
     * The folder block: main folder (switchable) plus this plugin's mounts.
     *
     * Rendered inline inside the current-project card and, unchanged, inside the
     * shared dialog — the two entries cannot drift apart.
     */
    /** A 2s confirmation chip: the only success feedback. No toast, no alert. */
    function SavedChip(props) {
      if (props.show !== true) return null;
      return h("span", { style: S.savedChip, role: "status" }, props.label);
    }

    /** Which block was just written; clears itself after 2 seconds. */
    function useSavedScope() {
      const [scope, setScope] = React.useState(null);
      React.useEffect(() => {
        if (scope === null) return undefined;
        const timer = setTimeout(() => setScope(null), 2000);
        return () => clearTimeout(timer);
      }, [scope]);
      return [scope, setScope];
    }

    /**
     * Every folder mutation of one dialog target.
     *
     * target = { kind: "project", project } | { kind: "workspace", workspace }
     * The two differ only in how the main folder is written (a project moves two
     * records, a bare workspace moves one); auxiliary folders exist for projects.
     */
    function useFolderActions(target, onChanged) {
      const t = useT();
      const isProject = target !== null && target !== undefined && target.kind === "project";
      const project = isProject ? target.project : null;
      const workspace = isProject ? null : (target ? target.workspace : null);
      const key = project !== null ? project.id : workspace !== null && workspace !== undefined ? workspace.id : "";
      const [busy, setBusy] = React.useState(false);
      const [error, setError] = React.useState(null);
      const [note, setNote] = React.useState(null);
      const [manual, setManual] = React.useState(false);
      const [manualPath, setManualPath] = React.useState("");
      const [draft, setDraft] = React.useState("");
      const [switched, setSwitched] = React.useState(null);
      const [savedScope, setSavedScope] = useSavedScope();

      // A different subject means different state: never carry a notice across.
      React.useEffect(() => {
        setBusy(false);
        setError(null);
        setNote(null);
        setSwitched(null);
        setManual(false);
        setManualPath("");
        setDraft("");
      }, [key]);

      const done = (scope) => {
        setSavedScope(scope);
        invalidateBoard();
        if (typeof onChanged === "function") onChanged();
      };

      const writeMain = (path) => {
        setBusy(true);
        setError(null);
        setNote(null);
        const body = isProject
          ? { action: "main", projectId: project.id, path }
          : { action: "workspace", workspaceId: workspace.id, path };
        postFolders(body).then(
          (json) => {
            setBusy(false);
            if (json.changed !== true) {
              setNote(t("dialog.unchanged"));
              return;
            }
            setSwitched({ before: json.before || "", after: json.folder, via: json.via });
            setManual(false);
            setManualPath("");
            done("main");
          },
          (failure) => {
            setBusy(false);
            // The host's message already names the operation and the rollback
            // ("切换主文件夹失败，已回滚到 …"); only wrap what is not.
            const message = messageOf(failure);
            setError(/^(切换主文件夹失败|Switching the main folder failed)/.test(message) ? message : t("dialog.failed", { error: message }));
          }
        );
      };

      const submitAux = (action, path) => {
        if (!isProject) return;
        setBusy(true);
        setError(null);
        setNote(null);
        postFolders({ action, projectId: project.id, path }).then(
          () => {
            setBusy(false);
            if (action === "add") setDraft("");
            done("aux");
          },
          (failure) => {
            setBusy(false);
            setError(t("dialog.failed", { error: messageOf(failure) }));
          }
        );
      };

      const choose = () => {
        setError(null);
        setNote(null);
        setBusy(true);
        pickFolder(service).then(
          (picked) => {
            if (picked === null || picked === undefined) {
              setBusy(false);
              return;
            }
            if (picked === "unavailable") {
              setBusy(false);
              setManual(true);
              setError(t("dialog.pickUnavailable"));
              return;
            }
            writeMain(picked);
          },
          (failure) => {
            setBusy(false);
            setManual(true);
            setError(t("dialog.pickFailed", { error: messageOf(failure) }));
          }
        );
      };

      return {
        t,
        isProject,
        project,
        workspace,
        busy,
        error,
        note,
        manual,
        manualPath,
        draft,
        switched,
        savedScope,
        setManual,
        setManualPath,
        setDraft,
        choose,
        writeMain,
        submitAux,
        cancelManual: () => {
          setManual(false);
          setManualPath("");
          setError(null);
        }
      };
    }

    /** A 14px folder glyph: no icon font, no extra dependency. */
    function FolderGlyph() {
      return h(
        "svg",
        {
          width: 14,
          height: 14,
          viewBox: "0 0 16 16",
          "aria-hidden": "true",
          style: { flex: "0 0 14px", opacity: 0.5 }
        },
        h("path", {
          d: "M2.5 4.5h4l1.2 1.5h5.8v6.5h-11z",
          fill: "none",
          stroke: "currentColor",
          strokeWidth: 1.2,
          strokeLinejoin: "round"
        })
      );
    }

    /**
     * The main-folder action row: one primary button, one inline link that
     * reveals a typed-path input. The path itself lives in the dialog header.
     */
    function MainFolderAction(props) {
      const actions = props.actions;
      const t = actions.t;
      return h(
        "div",
        null,
        h(
          "div",
          { style: S.actionRow },
          h(
            "button",
            { type: "button", style: actions.busy ? S.primaryDisabled : S.primary, disabled: actions.busy, onClick: actions.choose },
            actions.busy ? t("dialog.choosing") : t("dialog.change")
          ),
          h(
            "button",
            { type: "button", style: S.link, disabled: actions.busy, onClick: () => actions.setManual(actions.manual !== true) },
            t("dialog.manualLink")
          ),
          h(SavedChip, { show: actions.savedScope === "main", label: t("dialog.saved") })
        ),
        actions.manual === true
          ? h(
              "div",
              { style: S.actionRow },
              h("input", {
                type: "text",
                value: actions.manualPath,
                placeholder: t("dialog.pathPlaceholder"),
                style: S.input,
                disabled: actions.busy,
                onChange: (event) => actions.setManualPath(event.target.value),
                onKeyDown: (event) => {
                  if (event.key === "Enter" && actions.manualPath.trim().length > 0 && !actions.busy) actions.writeMain(actions.manualPath);
                }
              }),
              h(
                "button",
                {
                  type: "button",
                  style: actions.busy || actions.manualPath.trim().length === 0 ? S.buttonDisabled : S.button,
                  disabled: actions.busy || actions.manualPath.trim().length === 0,
                  onClick: () => actions.writeMain(actions.manualPath)
                },
                t("dialog.confirm")
              ),
              h("button", { type: "button", style: S.link, disabled: actions.busy, onClick: actions.cancelManual }, t("dialog.cancel"))
            )
          : null,
        actions.note !== null ? h("div", { style: S.faint }, actions.note) : null,
        actions.error !== null ? h("div", { style: S.error }, actions.error) : null,
        actions.switched !== null && actions.switched.via === "file" ? h("div", { style: S.warn }, t("dialog.viaFile")) : null
      );
    }

    /**
     * The auxiliary mount list: title + count badge, one row per mount, and the
     * add row. Used both inside the dialog and, collapsibly, in the board card.
     */
    function AuxFolders(props) {
      const actions = props.actions;
      const t = actions.t;
      const folders = Array.isArray(props.folders) ? props.folders : [];
      const upstream = Array.isArray(props.upstream) ? props.upstream : [];
      const expanded = props.expanded !== false;
      return h(
        "div",
        null,
        h(
          "div",
          { style: S.sectionHead },
          props.collapsible === true
            ? h(
                "button",
                {
                  type: "button",
                  style: S.link,
                  "aria-expanded": expanded,
                  onClick: props.onToggle
                },
                expanded ? "▾" : "▸"
              )
            : null,
          h("span", { style: S.sectionHeadTitle }, t("dialog.aux")),
          h("span", { style: S.badge }, String(folders.length)),
          h(SavedChip, { show: actions.savedScope === "aux", label: t("dialog.saved") })
        ),
        expanded
          ? h(
              "div",
              null,
              folders.length === 0
                ? h("div", { style: S.emptyLine }, t("dialog.auxEmpty"))
                : folders.map((folder) =>
                    h(
                      "div",
                      { style: S.folderRow, key: folder },
                      h(FolderGlyph),
                      h("span", { style: S.folderPath, title: folder }, folder),
                      h(
                        "button",
                        { type: "button", style: S.link, disabled: actions.busy, onClick: () => actions.submitAux("remove", folder) },
                        t("dialog.remove")
                      )
                    )
                  ),
              upstream.length > 0 ? h("div", { style: S.emptyLine }, t("dialog.upstream", { list: upstream.join(", ") })) : null,
              h(
                "div",
                { style: S.actionRow },
                h("input", {
                  type: "text",
                  value: actions.draft,
                  placeholder: t("dialog.addPlaceholder"),
                  style: S.input,
                  disabled: actions.busy,
                  onChange: (event) => actions.setDraft(event.target.value),
                  onKeyDown: (event) => {
                    if (event.key === "Enter" && actions.draft.trim().length > 0 && !actions.busy) actions.submitAux("add", actions.draft);
                  }
                }),
                h(
                  "button",
                  {
                    type: "button",
                    style: actions.busy || actions.draft.trim().length === 0 ? S.buttonDisabled : S.button,
                    disabled: actions.busy || actions.draft.trim().length === 0,
                    onClick: () => actions.submitAux("add", actions.draft)
                  },
                  actions.busy ? "…" : t("dialog.add")
                )
              )
            )
          : null
      );
    }

    /**
     * The dialog's single container, appended to document.body.
     *
     * A fixed-position child cannot escape a stacking context an ancestor created
     * (a transform, a filter, a contain, an isolation): a z-index of 9999 only
     * ranks inside that context. Portalling into <body> is the only way to sit
     * above the sidebar panel, the settings sheet and dsh-threads' own modal alike.
     */
    function dialogRoot() {
      try {
        if (typeof document === "undefined" || document.body === null || document.body === undefined) return null;
        const existing = typeof document.getElementById === "function" ? document.getElementById(DIALOG_ROOT_ID) : null;
        if (existing !== null && existing !== undefined) return existing;
        const node = document.createElement("div");
        node.id = DIALOG_ROOT_ID;
        node.setAttribute("role", "dialog");
        node.setAttribute("aria-modal", "true");
        node.setAttribute("aria-labelledby", DIALOG_TITLE_ID);
        document.body.appendChild(node);
        return node;
      } catch (error) {
        warn("cannot create the dialog container", error);
        return null;
      }
    }

    /**
     * The dialog body: header (name / "current main folder" / path), one action
     * row, a divider, the auxiliary list and one footnote line.
     */
    /**
     * The freshest copy of the dialog's subject.
     *
     * The snapshot holds the object that was current when the dialog opened; after
     * an auxiliary folder is added or removed the board reloads, and the list must
     * show the new state without closing and reopening the dialog.
     */
    function resolveSubject(target, data) {
      if (target.kind === "project") {
        const found = (data.projects || []).find((project) => project.id === target.project.id);
        return { kind: "project", project: found === undefined ? target.project : found };
      }
      const found = (data.workspaces || []).find((workspace) => workspace.id === target.workspace.id);
      return { kind: "workspace", workspace: found === undefined ? target.workspace : found };
    }

    function FolderDialogBody(props) {
      const board = useBoard();
      const target = resolveSubject(props.target, board.data);
      const actions = useFolderActions(target, invalidateBoard);
      const t = actions.t;
      const isProject = target.kind === "project";
      const subject = isProject ? target.project : target.workspace;
      const stored = isProject ? subject.folder : subject.path;
      // After a switch the fresh path is the host's own echo, not the stale
      // object this dialog was opened with.
      const path = actions.switched !== null ? actions.switched.after : stored || t("folders.unknown");
      return h(
        "div",
        {
          style: S.scrim,
          onMouseDown: (event) => {
            if (event.target === event.currentTarget) dialogStore.hide();
          }
        },
        h(
          "div",
          { style: S.modal },
          h(
            "div",
            { style: S.modalHead },
            h(
              "div",
              { style: { flex: "1 1 auto", minWidth: 0 } },
              h("div", { style: S.modalTitle, id: DIALOG_TITLE_ID, title: String(subject.title ?? "") }, String(subject.title ?? "")),
              h("div", { style: S.modalOverline }, t("dialog.currentMain")),
              h("div", { style: S.modalPath, title: path }, path)
            ),
            h(
              "button",
              { type: "button", style: S.closeButton, title: t("dialog.close"), "aria-label": t("dialog.close"), onClick: () => dialogStore.hide() },
              "✕"
            )
          ),
          h(MainFolderAction, { actions }),
          isProject ? h("div", { style: S.divider }) : null,
          isProject
            ? h(AuxFolders, {
                actions,
                folders: subject.extraFolders || [],
                upstream: subject.upstreamFolders || [],
                expanded: true
              })
            : null,
          h(
            "div",
            { style: S.footnote },
            (isProject ? t("dialog.footnote") : t("dialog.footnoteWorkspace")) +
              (isProject && props.sandboxAvailable !== true ? " " + t("dialog.footnoteNoSandbox") : "")
          )
        )
      );
    }

    /**
     * The one folder dialog. Mounted once through the shell overlay so the board
     * button, the settings page row and the injected button open the same thing.
     */
    function FolderDialog() {
      const state = useStore(dialogStore.subscribe, dialogStore.getSnapshot);
      // Esc closes from anywhere, and the body stops scrolling behind the scrim.
      React.useEffect(() => {
        if (!state.open) return undefined;
        const onKey = (event) => {
          if (event.key === "Escape") dialogStore.hide();
        };
        try {
          document.addEventListener("keydown", onKey, true);
        } catch {
          return undefined;
        }
        return () => {
          try {
            document.removeEventListener("keydown", onKey, true);
          } catch {
            // a document that refuses the removal is not worth failing over
          }
        };
      }, [state.open]);
      React.useEffect(() => {
        if (!state.open) return undefined;
        const body = typeof document === "undefined" ? null : document.body;
        if (body === null || body === undefined) return undefined;
        const previous = body.style.overflow;
        body.style.overflow = "hidden";
        return () => {
          body.style.overflow = previous;
        };
      }, [state.open]);
      // Leave no empty role="dialog" node behind once the portal has unmounted,
      // but never pull the container out from under the ⚙ panel, which shares it.
      React.useEffect(() => {
        if (state.open) return undefined;
        if (panelStore.getSnapshot().open === true) return undefined;
        try {
          if (typeof document === "undefined" || document.body === null || document.body === undefined) return undefined;
          const node = typeof document.getElementById === "function" ? document.getElementById(DIALOG_ROOT_ID) : null;
          if (node !== null && node !== undefined && node.parentNode === document.body) document.body.removeChild(node);
        } catch (error) {
          warn("cannot remove the dialog container", error);
        }
        return undefined;
      }, [state.open]);
      if (!state.open) return null;
      const project = state.kind === "project" ? state.project : null;
      const workspace = state.kind === "workspace" ? state.workspace : null;
      const subject = project !== null ? project : workspace;
      if (subject === null || subject === undefined) return null;
      const target = project !== null ? { kind: "project", project } : { kind: "workspace", workspace };
      const tree = h(FolderDialogBody, { target, sandboxAvailable: state.sandboxAvailable === true });
      const root = dialogRoot();
      if (root !== null && ReactDOM !== null && typeof ReactDOM.createPortal === "function") {
        return ReactDOM.createPortal(tree, root);
      }
      // No portal available (a host without document, or without react-dom):
      // render in place rather than losing the dialog entirely.
      return tree;
    }

    /**
     * The current-project card's folder area: the auxiliary mounts, collapsed,
     * plus the one footnote line. The main folder is changed from the dialog.
     */
    function CurrentProjectFolders(props) {
      const project = props.project;
      const actions = useFolderActions({ kind: "project", project }, props.onChanged);
      const t = actions.t;
      const [auxOpen, setAuxOpen] = React.useState(false);
      return h(
        "div",
        { style: { marginTop: SPACE } },
        h(AuxFolders, {
          actions,
          folders: project.extraFolders || [],
          upstream: project.upstreamFolders || [],
          expanded: auxOpen,
          collapsible: true,
          onToggle: () => setAuxOpen(!auxOpen)
        }),
        h(
          "div",
          { style: S.footnote },
          t("dialog.footnote") + (props.sandboxAvailable === true ? "" : " " + t("dialog.footnoteNoSandbox"))
        )
      );
    }

    // ---------- project card ----------
    /**
     * One project. The current project gets the accent rail and its folder block;
     * every other project is a compact hairline-separated card that expands into
     * its thread and task rows.
     */
    function ProjectCard(props) {
      const project = props.project;
      const t = props.t;
      const lang = props.lang;
      const current = props.current === true;
      const [open, setOpen] = React.useState(current || props.defaultExpanded === true);
      React.useEffect(() => {
        setOpen(current === true || props.defaultExpanded === true);
      }, [project.id, current, props.defaultExpanded]);
      const threads = Array.isArray(project.threads) ? project.threads : [];
      const tasks = Array.isArray(project.tasks) ? project.tasks : [];
      const [rowStyle, rowHandlers] = useHoverStyle(S.rowButton);

      const body = open
        ? h(
            "div",
            null,
            h("div", { style: S.subLabel }, t("threads.title", { count: threads.length })),
            threads.length === 0
              ? h("div", { style: S.emptyLine }, t("threads.empty"))
              : threads.map((thread) => h(ThreadRow, { key: "t" + thread.n, thread, t })),
            project.hidden > 0 ? h("div", { style: S.emptyLine }, t("board.hidden", { count: project.hidden })) : null,
            h("div", { style: S.subLabel }, t("tasks.title", { count: tasks.length })),
            tasks.length === 0
              ? h("div", { style: S.emptyLine }, t("tasks.empty"))
              : tasks.map((task) => h(TaskRow, { key: String(task.id), task, t }))
          )
        : null;

      const meta = h(
        "div",
        { style: S.meta },
        h("span", null, t("card.threads", { count: threads.length })),
        h("span", null, t("card.tasks", { count: tasks.length })),
        h("span", null, t("card.activity", { time: relativeTime(project.activity, lang, props.now) }))
      );

      if (current) {
        return h(
          "div",
          { style: S.currentCard },
          h("span", { style: S.accentRail, "aria-hidden": "true" }),
          h(
            "div",
            { style: S.cardColumn },
            h(
              "div",
              { style: S.cardHead },
              h(
                "div",
                { style: S.cardTitleBox },
                h("div", { style: S.cardTitle, title: project.title || "" }, project.title || ""),
                h("div", { style: S.path, title: project.folder || "" }, project.folder || t("folders.unknown")),
                meta
              ),
              h(
                "div",
                { style: { display: "flex", alignItems: "center", gap: SPACE, flex: "0 0 auto" } },
                h(
                  "button",
                  {
                    type: "button",
                    style: S.button,
                    onClick: () => dialogStore.showProject(project, { sandboxAvailable: props.sandboxAvailable === true })
                  },
                  t("dialog.change")
                ),
                h(
                  "button",
                  {
                    type: "button",
                    style: S.ghost,
                    "aria-expanded": open,
                    title: open ? t("board.collapse") : t("board.expand"),
                    onClick: () => setOpen(!open)
                  },
                  open ? "▾" : "▸"
                )
              )
            ),
            h(CurrentProjectFolders, { project, onChanged: props.onChanged, sandboxAvailable: props.sandboxAvailable }),
            body
          )
        );
      }

      return h(
        "div",
        { style: props.first === true ? S.otherCardFirst : S.otherCard },
        h(
          "button",
          { type: "button", style: rowStyle, ...rowHandlers, "aria-expanded": open, onClick: () => setOpen(!open) },
          h("span", { style: S.ghost }, open ? "▾" : "▸"),
          h(
            "div",
            { style: { flex: "1 1 auto", minWidth: 0 } },
            h("div", { style: S.cardTitle, title: project.title || "" }, project.title || ""),
            meta
          )
        ),
        body
      );
    }

    /** The sticky divider between the current project and everything else. */
    function SectionBar(props) {
      return h(
        "div",
        { style: S.sectionBar },
        h("span", { style: S.sectionLabel }, props.label),
        props.hint === undefined || props.hint === null ? null : h("span", { style: S.sectionCount }, props.hint)
      );
    }

    // ---------- project board tab ----------
    function BoardTab() {
      const t = useT();
      const lang = useLang();
      const board = useBoard();
      const settings = useSettings();
      const panel = useStore(panelStore.subscribe, panelStore.getSnapshot);
      const data = board.data;
      const grouped = sortProjects(data.projects, data.currentProjectId, settings.sort);
      const total = data.projects.length;
      const now = Date.now();

      const sectionLabel =
        grouped.current !== null
          ? t("board.section.others", { count: grouped.others.length })
          : t("board.section.all", { count: total });

      return h(
        "div",
        { style: S.root },
        h(
          "div",
          { style: S.header },
          h("span", { style: S.title }, t("tab.title")),
          // Settings sit left of Refresh: one ⚙, same portal, anchored under itself.
          h(
            "button",
            {
              type: "button",
              style: S.button,
              title: t("panel.title"),
              "aria-label": t("panel.title"),
              "aria-haspopup": "dialog",
              "aria-expanded": panel.open === true,
              onClick: (event) => panelStore.toggle(event.currentTarget.getBoundingClientRect())
            },
            "⚙"
          ),
          h("button", { type: "button", style: S.button, onClick: board.refresh, title: t("board.refresh") }, t("board.refresh"))
        ),
        h(
          "div",
          { style: S.body },
          board.error !== null ? h("div", { style: S.error }, t("board.failed", { error: board.error })) : null,
          board.loading && total === 0 ? h("div", { style: S.emptyLine }, t("board.loading")) : null,
          !board.loading && board.error === null && total === 0 ? h("div", { style: S.emptyLine }, t("board.empty")) : null,
          grouped.current !== null
            ? h(ProjectCard, {
                project: grouped.current,
                current: true,
                t,
                lang,
                now,
                sandboxAvailable: data.sandbox.available === true,
                onChanged: board.refresh
              })
            : null,
          total > 0 ? h(SectionBar, { label: sectionLabel }) : null,
          grouped.others.map((project, index) =>
            h(ProjectCard, {
              key: project.id,
              project,
              current: false,
              first: index === 0,
              defaultExpanded: settings.otherCardsExpanded === true,
              t,
              lang,
              now,
              sandboxAvailable: data.sandbox.available === true,
              onChanged: board.refresh
            })
          )
        )
      );
    }

    // ---------- settings page section (entry B) ----------
    /**
     * Every project and workspace, one row each, one "Change" button per row.
     *
     * Deliberately no "change all": a single stray click must never rewrite a
     * dozen project records at once.
     */
    function SettingsSection(props) {
      const compact = props !== null && props !== undefined && props.compact === true;
      const t = useT();
      const lang = useLang();
      const board = useBoard();
      const data = board.data;
      const projects = data.projects;
      const workspaces = data.workspaces;

      const projectRow = (project) =>
        h(
          "div",
          { style: S.settingsRow, key: "p-" + project.id },
          h(
            "div",
            { style: S.settingsRowMain },
            h("div", { style: S.settingsRowTitle, title: project.title || "" }, project.title || project.id),
            h("div", { style: S.path, title: project.folder || "" }, project.folder || t("folders.unknown")),
            h(
              "div",
              { style: S.settingsNote },
              t("settings.auxCount", { count: (project.extraFolders || []).length }) +
                " · " +
                t("card.activity", { time: relativeTime(project.activity, lang, Date.now()) })
            )
          ),
          h(
            "button",
            {
              type: "button",
              style: S.button,
              onClick: () => dialogStore.showProject(project, { sandboxAvailable: data.sandbox.available === true })
            },
            t("settings.modify")
          )
        );

      const workspaceRow = (workspace) =>
        h(
          "div",
          { style: S.settingsRow, key: "w-" + workspace.id },
          h(
            "div",
            { style: S.settingsRowMain },
            h("div", { style: S.settingsRowTitle, title: workspace.title || workspace.id }, workspace.title || workspace.id),
            h("div", { style: S.path, title: workspace.path || "" }, workspace.missing === true ? t("settings.missingWorkspace") : workspace.path || t("folders.unknown")),
            h(
              "div",
              { style: S.settingsNote },
              workspace.projectId !== null
                ? t("settings.owned", { title: workspaceTitle(projects, workspace.projectId) }) +
                  " · " +
                  t("settings.auxCount", { count: workspace.extraFolderCount })
                : t("settings.unowned") + " · " + t("settings.sessions", { count: workspace.sessionCount })
            )
          ),
          workspace.editable === true && workspace.missing !== true
            ? h("button", { type: "button", style: S.button, onClick: () => dialogStore.showWorkspace(workspace) }, t("settings.modify"))
            : null
        );

      return h(
        "div",
        { style: S.settingsRoot },
        compact ? null : h("div", { style: S.settingsRowTitle }, t("settings.title")),
        compact ? null : h("div", { style: S.hint }, t("settings.intro")),
        board.error !== null ? h("div", { style: S.error }, t("settings.failed", { error: board.error })) : null,
        board.loading && projects.length === 0 ? h("div", { style: S.emptyLine }, t("settings.loading")) : null,
        !board.loading && board.error === null && projects.length === 0 && workspaces.length === 0
          ? h("div", { style: S.emptyLine }, t("settings.empty"))
          : null,
        h("div", { style: S.settingsGroup }, h("div", { style: S.subLabel }, t("settings.projects", { count: projects.length })), projects.map(projectRow)),
        h(
          "div",
          { style: S.settingsGroup },
          h("div", { style: S.subLabel }, t("settings.workspaces", { count: workspaces.length })),
          workspaces.length === 0 ? h("div", { style: S.emptyLine }, t("settings.empty")) : workspaces.map(workspaceRow)
        ),
        h("div", { style: S.footnote }, t("settings.footnote"))
      );
    }

    /** The project title of a workspace owner, for the settings note. */
    function workspaceTitle(projects, projectId) {
      for (const project of projects ?? []) {
        if (project !== null && project.id === projectId) return project.title || project.id;
      }
      return projectId;
    }

    // ---------- small shell seats ----------
    /**
     * Picker icon. The right-pane "open a tab" list draws a provider icon per
     * entry (a generic cube when none is given); returning our own component
     * keeps the plugin's ▤ glyph instead of the host default.
     */
    function TabIcon() {
      return h("span", { "aria-hidden": "true", style: { fontSize: 15, lineHeight: 1 } }, TAB_ICON);
    }

    /**
     * Tab title seat. Registering this slot replaces the host's default title
     * rendering (a generic cube icon plus the label) with our own markup.
     */
    function TabTitle() {
      const t = useT();
      return h(
        "span",
        { style: { display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, lineHeight: 1.2 } },
        h("span", { "aria-hidden": "true", style: { fontSize: 12 } }, TAB_ICON),
        h("span", null, t("tab.title"))
      );
    }

    /** Small button for the session header, next to the thread-list action. */
    function HeaderAction(props) {
      const t = useT();
      const sessionId = typeof props.sessionId === "string" ? props.sessionId : "";
      React.useEffect(() => {
        if (sessionId.length > 0) lastSessionId = sessionId;
      }, [sessionId]);
      return h(
        "button",
        {
          type: "button",
          title: t("board.open"),
          onClick: () => {
            // The header is the only place that knows which conversation the
            // panel is opened from; record it before the panel asks the host.
            if (sessionId.length > 0) lastSessionId = sessionId;
            invalidateBoard();
            props.openBoard();
          },
          style: {
            border: "1px solid " + BORDER_STRONG,
            background: "transparent",
            color: "inherit",
            borderRadius: SPACE,
            padding: "4px " + SPACE + "px",
            fontSize: 12,
            cursor: "pointer"
          }
        },
        h("span", { "aria-hidden": "true" }, TAB_ICON),
        h("span", null, " " + t("tab.title"))
      );
    }

    // ---------- board settings popover ----------
    function viewportWidth() {
      try {
        if (typeof window !== "undefined" && Number.isFinite(window.innerWidth) && window.innerWidth > 0) return window.innerWidth;
      } catch {
        // no window: fall through
      }
      return 1024;
    }

    function viewportHeight() {
      try {
        if (typeof window !== "undefined" && Number.isFinite(window.innerHeight) && window.innerHeight > 0) return window.innerHeight;
      } catch {
        // no window: fall through
      }
      return 768;
    }

    /** Three-and-two-way choices: one small pill per option, the active one accented. */
    function Segmented(props) {
      return h(
        "div",
        { style: S.segmented, role: "group", "aria-label": props.label },
        props.options.map((option) =>
          h(
            "button",
            {
              key: option.value,
              type: "button",
              style: option.value === props.value ? { ...S.segment, ...S.segmentActive } : S.segment,
              "aria-pressed": option.value === props.value,
              disabled: props.disabled === true,
              onClick: () => props.onChange(option.value)
            },
            option.label
          )
        )
      );
    }

    /** A switch in the panel's own style: 28×16 track, 10px knob, accent when on. */
    function ToggleSwitch(props) {
      const on = props.checked === true;
      return h(
        "button",
        {
          type: "button",
          role: "switch",
          style: on ? { ...S.switchTrack, ...S.switchTrackOn } : S.switchTrack,
          "aria-checked": on,
          "aria-label": props.label,
          disabled: props.disabled === true,
          onClick: () => props.onChange(!on)
        },
        h("span", { style: on ? { ...S.switchKnob, ...S.switchKnobOn } : S.switchKnob, "aria-hidden": "true" })
      );
    }

    /** One line per preference: label on the left, control on the right. */
    function SettingRow(props) {
      return h("div", { style: S.settingRow }, h("span", { style: S.settingLabel }, props.label), props.control);
    }

    function SettingsPanelBody(props) {
      const state = props.state;
      const settings = props.settings;
      const lang = props.lang;
      const t = props.t;
      const width = Math.min(state.view === "manage" ? 460 : 360, viewportWidth() - 24);
      const anchor = state.anchor;
      const top = anchor !== null && anchor !== undefined ? Math.round(anchor.bottom + 6) : 56;
      const right = anchor !== null && anchor !== undefined ? Math.max(12, Math.round(viewportWidth() - anchor.right)) : 12;
      const maxHeight = Math.max(240, viewportHeight() - top - 12);
      const busy = settings.saving === true;
      const set = (patch) => {
        settingsStore.patch(patch).catch(() => {
          // the row shows the error from the store; nothing else to do here
        });
      };
      const languageOptions = [
        { value: "auto", label: t("panel.languageAuto", { lang: t("lang." + lang) }) },
        { value: "zh", label: t("lang.zh") },
        { value: "en", label: t("lang.en") }
      ];
      return h(
        "div",
        {
          style: S.panelScrim,
          onMouseDown: (event) => {
            if (event.target === event.currentTarget) panelStore.hide();
          }
        },
        h(
          "div",
          { style: { ...S.panel, top, right, width, maxHeight }, role: "dialog", "aria-label": t("panel.title") },
          h(
            "div",
            { style: S.panelHead },
            state.view === "manage"
              ? h("button", { type: "button", style: S.link, onClick: () => panelStore.setView("settings") }, "‹ " + t("panel.manageBack"))
              : h("span", { style: S.panelTitle }, t("panel.title")),
            h(
              "button",
              { type: "button", style: S.closeButton, title: t("panel.close"), "aria-label": t("panel.close"), onClick: () => panelStore.hide() },
              "✕"
            )
          ),
          state.view === "manage"
            ? h(SettingsSection, { compact: true })
            : h(
                "div",
                null,
                h(SettingRow, {
                  label: t("panel.language"),
                  control: h(Segmented, {
                    t,
                    label: t("panel.language"),
                    value: settings.language,
                    disabled: busy,
                    options: languageOptions,
                    onChange: (value) => set({ language: value })
                  })
                }),
                h(SettingRow, {
                  label: t("panel.showResolved"),
                  control: h(ToggleSwitch, {
                    label: t("panel.showResolved"),
                    checked: settings.showResolvedThreads === true,
                    disabled: busy,
                    onChange: (value) => set({ showResolvedThreads: value })
                  })
                }),
                h(SettingRow, {
                  label: t("panel.converge"),
                  control: h(ToggleSwitch, {
                    label: t("panel.converge"),
                    checked: settings.autoConvergeReports === true,
                    disabled: busy,
                    onChange: (value) => set({ autoConvergeReports: value })
                  })
                }),
                h(SettingRow, {
                  label: t("panel.otherCards"),
                  control: h(Segmented, {
                    t,
                    label: t("panel.otherCards"),
                    value: settings.otherCardsExpanded === true ? "expanded" : "collapsed",
                    disabled: busy,
                    options: [
                      { value: "collapsed", label: t("panel.collapsed") },
                      { value: "expanded", label: t("panel.expanded") }
                    ],
                    onChange: (value) => set({ otherCardsExpanded: value === "expanded" })
                  })
                }),
                h(SettingRow, {
                  label: t("panel.sort"),
                  control: h(Segmented, {
                    t,
                    label: t("panel.sort"),
                    value: settings.sort,
                    disabled: busy,
                    options: [
                      { value: "activity", label: t("panel.sortActivity") },
                      { value: "title", label: t("panel.sortTitle") }
                    ],
                    onChange: (value) => set({ sort: value })
                  })
                }),
                h("div", { style: S.divider }),
                h("button", { type: "button", style: S.link, onClick: () => panelStore.setView("manage") }, t("panel.manage")),
                settings.error !== null ? h("div", { style: S.panelError }, t("panel.failed", { error: settings.error })) : null
              )
        )
      );
    }

    /** The ⚙ popover: same portal, same container, anchored under its button. */
    function SettingsPanel() {
      const state = useStore(panelStore.subscribe, panelStore.getSnapshot);
      const settings = useSettings();
      const lang = useLang();
      const t = useT();
      React.useEffect(() => {
        if (!state.open) return undefined;
        const onKey = (event) => {
          if (event.key === "Escape") panelStore.hide();
        };
        try {
          document.addEventListener("keydown", onKey, true);
        } catch {
          return undefined;
        }
        return () => {
          try {
            document.removeEventListener("keydown", onKey, true);
          } catch {
            // ignore
          }
        };
      }, [state.open]);
      // Both overlays share one container; only the last one closed removes it.
      React.useEffect(() => {
        if (state.open) return undefined;
        if (dialogStore.getSnapshot().open === true) return undefined;
        try {
          if (typeof document === "undefined" || document.body === null || document.body === undefined) return undefined;
          const node = typeof document.getElementById === "function" ? document.getElementById(DIALOG_ROOT_ID) : null;
          if (node !== null && node !== undefined && node.parentNode === document.body) document.body.removeChild(node);
        } catch (error) {
          warn("cannot remove the dialog container", error);
        }
        return undefined;
      }, [state.open]);
      if (!state.open) return null;
      const tree = h(SettingsPanelBody, { state, settings, lang, t });
      const root = dialogRoot();
      if (root !== null && ReactDOM !== null && typeof ReactDOM.createPortal === "function") {
        return ReactDOM.createPortal(tree, root);
      }
      return tree;
    }

    /** Shell overlay occupant: the folder dialog and the ⚙ popover, rendered once. */
    function Overlay() {
      return h("div", null, h(FolderDialog), h(SettingsPanel));
    }

    // ---------- entry C: a button inside dsh-threads' own folder card ----------
    /**
     * Watch the document for dsh-threads' project-settings folder card and add
     * one "more folders" button to it.
     *
     * Contract, in order of importance:
     *   1. never throw into the host -- every DOM read and write is guarded;
     *   2. idempotent -- a block that already carries the button only gets its
     *      label refreshed, never a second button;
     *   3. degrade quietly -- no dialog on screen, no anchor, or no observer means
     *      no button, and the rest of the plugin is unaffected.
     *
     * options.document - the document to watch (injected so the harness can fake it)
     * options.open     - called with the folder path shown in the card
     * options.label    - the button copy for the current language
     */
    function createThreadsInjector(options) {
      const doc = options && options.document ? options.document : null;
      const open = options && typeof options.open === "function" ? options.open : () => {};
      const label = options && typeof options.label === "function" ? options.label : () => "\u22EF";
      let observer = null;
      let timer = null;
      let stopped = true;

      if (doc === null) {
        return { start: () => () => {}, stop: () => {}, scan: () => 0, schedule: () => {} };
      }

      /** The folder cards currently rendered, each with the path it shows. */
      function findAnchors() {
        const found = [];
        if (typeof doc.querySelectorAll !== "function") return found;
        const nodes = doc.querySelectorAll(".dsht-setting-path");
        for (const node of nodes) {
          const block = typeof node.closest === "function" ? node.closest(".dsht-setting-block") : null;
          if (block === null || block === undefined) continue;
          const titled = typeof node.getAttribute === "function" ? node.getAttribute("title") : "";
          found.push({ block, path: String(titled || node.textContent || "") });
        }
        return found;
      }

      function scan() {
        try {
          if (stopped) return 0;
          // Cheap guard: dsh-threads' settings dialog is not on screen.
          if (typeof doc.querySelector !== "function" || doc.querySelector(".dsht-settings") === null) return 0;
          let injected = 0;
          for (const anchor of findAnchors()) {
            const existing =
              typeof anchor.block.querySelector === "function" ? anchor.block.querySelector("[" + INJECT_ATTR + "]") : null;
            if (existing !== null && existing !== undefined) {
              if (existing.textContent !== label()) existing.textContent = label();
              continue;
            }
            const button = doc.createElement("button");
            button.type = "button";
            button.setAttribute(INJECT_ATTR, "");
            button.textContent = label();
            try {
              button.style.cssText =
                "margin-top:8px;border:1px solid rgba(127,127,127,0.26);background:transparent;color:inherit;" +
                "border-radius:8px;padding:4px 8px;font-family:" + TEXT_FONT + ";font-size:12px;line-height:1.4;cursor:pointer";
            } catch (error) {
              // a styled button is a nicety; an unstyled one still works
            }
            button.addEventListener("click", () => {
              try {
                open(anchor.path);
              } catch (error) {
                warn("the injected folder button failed", error);
              }
            });
            anchor.block.appendChild(button);
            injected += 1;
          }
          return injected;
        } catch (error) {
          // The host's DOM is not ours: losing the button is the only acceptable
          // outcome, so this never rethrows.
          warn("cannot inject into the dsh-threads settings card", error);
          return 0;
        }
      }

      function schedule() {
        if (stopped || timer !== null) return;
        timer = setTimeout(() => {
          timer = null;
          scan();
        }, 120);
      }

      function stop() {
        stopped = true;
        try {
          if (observer !== null) observer.disconnect();
        } catch (error) {
          // ignore
        }
        observer = null;
        if (timer !== null) {
          clearTimeout(timer);
          timer = null;
        }
      }

      function start() {
        stopped = false;
        scan();
        try {
          const Observer = typeof MutationObserver === "function" ? MutationObserver : undefined;
          if (Observer !== undefined && doc.body !== undefined && doc.body !== null) {
            observer = new Observer(schedule);
            observer.observe(doc.body, { childList: true, subtree: true });
          }
        } catch (error) {
          warn("cannot watch the document for the dsh-threads settings dialog", error);
        }
        return stop;
      }

      return { start, stop, scan, schedule };
    }

    /** Open the board tab; the fallback when the injected card names an unknown folder. */
    let openBoardTab = () => {};

    /**
     * The injected button's click path: resolve the folder shown in dsh-threads'
     * card to one of our projects, then open the shared dialog on it.
     */
    function openFolderDialogFor(path) {
      if (typeof path !== "string" || path.trim().length === 0) return;
      fetchBoard(true, lastSessionId).then(
        (data) => {
          const project = findProjectByFolder(data.projects, path);
          if (project === null) {
            // A folder dsh-threads knows but our registry does not (a project
            // created while the panel was cold): send the human to the board
            // rather than opening a dialog on the wrong project.
            warn("no project record for " + path);
            openBoardTab();
            return;
          }
          dialogStore.showProject(project, { sandboxAvailable: data.sandbox !== undefined && data.sandbox.available === true });
        },
        (error) => warn("cannot read the board for " + path, error)
      );
    }

    // ---------- plugin ----------
    function apply(ctx) {
      const get = (name) => {
        try {
          return ctx.get(name);
        } catch {
          return undefined;
        }
      };
      service = get;
      const slots = get("slots");
      let injector = null;

      // Language: DSH's own locale service is the source of truth. The panel,
      // the dialog and the settings page re-render live when it changes; the
      // injected button refreshes its copy on the next scan.
      const locale = get("locale");
      if (locale !== undefined && locale !== null) {
        try {
          const active = typeof locale.getLocale === "function" ? locale.getLocale() : null;
          langStore.setApp(active && active.active ? active.active : detectLang());
        } catch (error) {
          warn("cannot read the active locale", error);
          langStore.setApp(detectLang());
        }
        try {
          // Registered so the namespace exists and the ledger matches what this
          // module shows. Translation itself reads the tables above, so a key
          // missing from the active language falls back to English rather than
          // to a raw identifier.
          ctx.effect(() => locale.register(NS, MESSAGES), "dsh-claude-project-ui: dictionaries");
        } catch (error) {
          warn("cannot register the locale dictionaries", error);
        }
        // Two wires, because either one alone can miss a switch: the
        // `locale/change` event (the documented signal) and the service's own
        // snapshot subscription (any locale revision). Neither is a one-shot read
        // of <html lang>, which would freeze the panel in the language it mounted
        // with.
        const followLocale = () => {
          try {
            const next = typeof locale.getLocale === "function" ? locale.getLocale() : null;
            langStore.setApp(next && next.active ? next.active : detectLang());
          } catch (error) {
            warn("locale change ignored", error);
          }
          if (injector !== null) injector.schedule();
        };
        try {
          ctx.on("locale/change", followLocale);
        } catch (error) {
          warn("cannot subscribe to locale changes", error);
        }
        try {
          if (typeof locale.subscribe === "function") {
            const off = locale.subscribe(followLocale);
            if (typeof off === "function") ctx.effect(() => off, "dsh-claude-project-ui: locale snapshot");
          }
        } catch (error) {
          warn("cannot subscribe to the locale snapshot", error);
        }
      } else {
        langStore.setApp(detectLang());
      }

      const tabs = get("sidebarRightTabs");
      const sidebarRight = get("sidebarRight");
      if (!slots) return;
      openBoardTab = () => {
        try {
          if (sidebarRight && typeof sidebarRight.openTab === "function") sidebarRight.openTab(TAB_KIND);
        } catch (error) {
          warn("openTab failed", error);
        }
      };

      try {
        if (tabs && typeof tabs.register === "function") {
          ctx.effect(() =>
            tabs.register({
              id: TAB_ID,
              kind: TAB_KIND,
              // Thunks, so a re-render of the host's tab list picks up a switch.
              title: () => translate(currentLang(), "tab.title"),
              guide: [
                {
                  id: "open",
                  order: 72,
                  title: () => translate(currentLang(), "tab.title"),
                  description: () => translate(currentLang(), "tab.description"),
                  icon: TabIcon
                }
              ]
            })
          );
        }
        slots.inject("sidebar.right.pane.tab", () =>
          slots.register({ name: "sidebar.right.pane.tab", key: TAB_ID, inject: () => ({}) }, BoardTab)
        );
        slots.inject("sidebar.right.pane.tab.title", () =>
          slots.register({ name: "sidebar.right.pane.tab.title", key: TAB_ID, inject: () => ({}) }, TabTitle)
        );
        slots.inject("conversation.session.header.actions", () =>
          slots.register(
            {
              name: "conversation.session.header.actions",
              id: TAB_ID,
              order: 16,
              inject: () => ({ openBoard: () => openBoardTab() })
            },
            HeaderAction
          )
        );
        // Entry B: the settings page section. One row per project and per
        // workspace, one "Change" each, no bulk action by design.
        slots.inject("settings.section", () =>
          slots.register(
            {
              name: "settings.section",
              id: SETTINGS_SECTION_ID,
              order: 62,
              label: () => translate(currentLang(), "settings.nav")
            },
            SettingsSection
          )
        );
        slots.inject("shell.overlay", () =>
          slots.register({ name: "shell.overlay", id: "project-hub-folders", order: 40 }, Overlay)
        );
      } catch (error) {
        warn("the board surfaces did not mount", error);
      }

      // Entry C. Started here so it dies with the plugin, and wrapped so a host
      // DOM that changed shape can never take the plugin down with it.
      try {
        injector = createThreadsInjector({
          document: typeof document === "undefined" ? null : document,
          open: openFolderDialogFor,
          label: () => translate(currentLang(), "threads.more")
        });
        ctx.effect(() => injector.start(), "dsh-claude-project-ui: dsh-threads folder injection");
      } catch (error) {
        warn("the dsh-threads injection did not mount", error);
      }
    }

    return {
      name: "dsh-claude-project-ui",
      // Same Cordis rule as on the host side: a service can only be read through
      // ctx.get when it is declared here. locale is declared because the whole
      // panel follows the app language: the web client always provides it
      // (dsh-client-locale), and a profile without it simply does not mount this
      // half instead of silently ignoring the app language setting.
      inject: ["locale", "slots", "sidebarRightTabs", "sidebarRight"],
      apply,
      /**
       * Test-only surface. The browser half is one self-contained bundle (the
       * client module loader evaluates it as a script), so the pure helpers and
       * the two small stores are reachable only through this object.
       */
      __test: {
        MESSAGES,
        translate,
        normalizeLang,
        sortProjects,
        relativeTime,
        normPath,
        findProjectByFolder,
        toneOf,
        threadCode,
        taskStatus,
        createThreadsInjector,
        resolveLanguage,
        normalizeClientSettings,
        sameSettings,
        SETTINGS_DEFAULTS,
        settingsStore,
        panelStore,
        dialogRoot,
        DIALOG_ROOT_ID,
        DIALOG_TITLE_ID,
        langStore,
        dialogStore,
        emptyBoard,
        INJECT_ATTR,
        TAB_ID,
        SETTINGS_SECTION_ID
      }
    };
  }
});
