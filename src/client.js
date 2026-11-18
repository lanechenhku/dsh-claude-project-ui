// dsh-claude-project-ui — browser half.
//
// Registers a "项目看板" tab in the right-hand sidebar pane (the same pane that
// hosts dsh-threads' thread list), plus a small header button that opens it.
// Data comes from POST /project-hub/board, served by this package's host half.
window.__ModuleLoader__.load({
  id: "dsh-claude-project-ui",
  factory: (require) => {
    const React = require("react");
    const h = React.createElement;

    const ROUTE = "/project-hub/board";
    const FOLDERS_ROUTE = "/project-hub/folders";
    const TAB_ID = "project-hub";
    const TAB_KIND = "project-hub";
    const TAB_ICON = "▤";
    const TAB_TITLE = "项目看板";
    const TAB_LABEL = TAB_ICON + " " + TAB_TITLE;

    // ---------- data ----------
    const cache = { at: 0, data: null, pending: null };

    function fetchBoard(force) {
      if (!force && cache.data !== null && Date.now() - cache.at < 5000) {
        return Promise.resolve(cache.data);
      }
      if (cache.pending !== null) return cache.pending;
      cache.pending = fetch(ROUTE, { method: "POST" })
        .then((response) => response.json())
        .then((json) => {
          if (!json || json.ok !== true) throw new Error((json && json.error) || "看板接口没有返回数据");
          cache.data = {
            projects: Array.isArray(json.projects) ? json.projects : [],
            sandbox: json.sandbox && typeof json.sandbox === "object" ? json.sandbox : { available: false }
          };
          cache.at = Date.now();
          return cache.data;
        })
        .finally(() => {
          cache.pending = null;
        });
      return cache.pending;
    }

    /**
     * Add or remove one auxiliary folder. The host validates the path (absolute,
     * existing directory, physical spelling), persists the list and returns it.
     */
    function saveFolder(projectId, action, path) {
      return fetch(FOLDERS_ROUTE, {
        method: "POST",
        headers: { "content-type": "application/json", "x-project-hub": "1" },
        body: JSON.stringify({ action, projectId, path })
      })
        .then((response) => response.json())
        .then((json) => {
          if (!json || json.ok !== true) throw new Error((json && json.error) || "文件夹接口没有返回数据");
          return json;
        });
    }

    // ---------- i18n ----------
    // This client module deliberately does not declare the `locale` service: a
    // profile without it must still mount the panel. Read it defensively and fall
    // back to the browser language (English for en*, Chinese otherwise).
    const MESSAGES = {
      zh: {
        main: "主文件夹",
        change: "切换文件夹…",
        choosing: "选择中…",
        switchHint: "用系统的文件夹选择器选一个目录；没有选择器时也可以手填路径。",
        switched: "已切换：{before} → {after}",
        restartNotice:
          "新会话和新讨论串要等 DeepSeek Harness 重启之后才用新文件夹；当前这个对话在你重启前仍留在原目录（{current}）。",
        unchanged: "主文件夹已经是这个目录，没有改。",
        pickUnavailable: "这个环境没有系统的文件夹选择器，请在下面手填绝对路径。",
        pickFailed: "没能打开文件夹选择器：{error}。可以手填路径。",
        switchFailed: "切换主文件夹失败：{error}",
        manualLabel: "手填路径",
        manualPlaceholder: "绝对路径，或 ~/ 开头",
        confirm: "确认切换",
        cancel: "取消",
        viaFile: "⚠ 宿主没有暴露 storageDomain 服务：这次是直接写存储文件，dsh-threads 下一次写可能覆盖。重启前请再确认面板里的路径没有变回去。",
        extras: "辅助文件夹（{count}）",
        extrasEmpty: "还没有挂载辅助文件夹",
        remove: "移除",
        removeTitle: "移除这个挂载",
        add: "添加",
        addPlaceholder: "绝对路径，或 ~/ 开头",
        upstream: "dsh-threads 自己挂载的（这里只读显示）：{list}",
        sandboxHint:
          "辅助文件夹会登记为项目每个会话的沙箱可写根（workspace-write 时对文件工具和 bash 生效；read-only 不授予写权限；重启 / resume 后自动重新登记）。",
        sandboxWarn:
          "⚠ 当前宿主没有 sandboxPolicy 服务：核心文件工具仍只能访问主文件夹；这些挂载目前只有本插件的 kb_add 读取可用。",
        opFailed: "操作失败：{error}",
        added: "已添加：{path}",
        removed: "已移除：{path}",
        unknownFolder: "（未知）"
      },
      en: {
        main: "Main folder",
        change: "Change folder…",
        choosing: "Choosing…",
        switchHint: "Pick a directory with the system folder chooser; you can also type a path when the chooser is unavailable.",
        switched: "Switched: {before} → {after}",
        restartNotice:
          "New sessions and threads use the new folder only after DeepSeek Harness restarts; this conversation stays in its original folder ({current}) until then.",
        unchanged: "The main folder is already this directory — nothing changed.",
        pickUnavailable: "This environment has no system folder chooser; type an absolute path below.",
        pickFailed: "Could not open the folder chooser: {error}. You can type a path instead.",
        switchFailed: "Switching the main folder failed: {error}",
        manualLabel: "Type a path",
        manualPlaceholder: "Absolute path, or ~/…",
        confirm: "Switch",
        cancel: "Cancel",
        viaFile:
          "⚠ The host exposes no storageDomain service: this wrote the storage files directly, and dsh-threads' next write may overwrite it. Check the path in this panel again before you restart.",
        extras: "Extra folders ({count})",
        extrasEmpty: "No extra folders yet",
        remove: "Remove",
        removeTitle: "Unmount this folder",
        add: "Add",
        addPlaceholder: "Absolute path, or ~/…",
        upstream: "Mounted by dsh-threads itself (read-only here): {list}",
        sandboxHint:
          "Extra folders are registered as writable sandbox roots for every session of this project (workspace-write only; read-only grants nothing; re-registered automatically after a restart / resume).",
        sandboxWarn:
          "⚠ The host has no sandboxPolicy service: the core file tools can still only reach the main folder; these mounts are readable by this plugin's kb_add only.",
        opFailed: "Failed: {error}",
        added: "Added: {path}",
        removed: "Removed: {path}",
        unknownFolder: "(unknown)"
      }
    };

    let LANG = null;
    /** Read a client service without declaring it: a missing one returns undefined. */
    let service = () => undefined;

    function language() {
      if (LANG !== null) return LANG;
      const tag =
        String((typeof document !== "undefined" && document.documentElement.lang) || "").toLowerCase() ||
        String((typeof navigator !== "undefined" && navigator.language) || "").toLowerCase();
      return tag.startsWith("en") ? "en" : "zh";
    }

    function t(key, vars) {
      const table = MESSAGES[language()] || MESSAGES.zh;
      let text = table[key] !== undefined ? table[key] : MESSAGES.zh[key] !== undefined ? MESSAGES.zh[key] : key;
      for (const [name, value] of Object.entries(vars || {})) {
        text = text.split("{" + name + "}").join(String(value));
      }
      return text;
    }

    /**
     * The folder chooser DSH itself uses (dsh-client-ui-directory-picker-native):
     * Electron's dialog on Desktop through the global, the host's picker otherwise.
     * Resolves a path, null when the user cancels, or "unavailable".
     */
    async function pickFolder() {
      const desktop = typeof globalThis !== "undefined" ? globalThis.__DSH_DIRECTORY_PICKER__ : undefined;
      if (desktop && typeof desktop.pick === "function") return await desktop.pick();
      const workspace = service("uiWorkspace");
      if (workspace && typeof workspace.pickDirectory === "function") {
        try {
          return await workspace.pickDirectory();
        } catch (error) {
          if (/unavailab|not support|not implement|cannot/i.test(String((error && error.message) || error))) return "unavailable";
          throw error;
        }
      }
      return "unavailable";
    }

    const EMPTY_SANDBOX = { available: false };

    function useBoard() {
      const [state, setState] = React.useState({ loading: true, error: null, projects: [], sandbox: EMPTY_SANDBOX });
      const refresh = React.useCallback(() => {
        setState((prev) => ({ loading: true, error: null, projects: prev.projects, sandbox: prev.sandbox }));
        fetchBoard(true).then(
          (snapshot) => setState({ loading: false, error: null, projects: snapshot.projects, sandbox: snapshot.sandbox }),
          (error) => setState({ loading: false, error: String((error && error.message) || error), projects: [], sandbox: EMPTY_SANDBOX })
        );
      }, []);
      React.useEffect(() => {
        refresh();
      }, [refresh]);
      return { loading: state.loading, error: state.error, projects: state.projects, sandbox: state.sandbox, refresh };
    }

    // ---------- styles ----------
    const S = {
      root: { display: "flex", flexDirection: "column", height: "100%", minHeight: 0, font: "13px/1.55 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" },
      header: { display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderBottom: "1px solid rgba(127,127,127,0.22)", flex: "0 0 auto" },
      title: { fontWeight: 600, fontSize: 13, flex: 1 },
      iconButton: { border: "1px solid rgba(127,127,127,0.28)", background: "transparent", color: "inherit", borderRadius: 6, padding: "2px 8px", fontSize: 12, cursor: "pointer" },
      body: { overflowY: "auto", padding: "8px 12px 16px", flex: "1 1 auto", minHeight: 0 },
      project: { marginBottom: 18 },
      projectTitle: { fontWeight: 600, fontSize: 12, opacity: 0.9, marginBottom: 2 },
      folder: { fontSize: 11, opacity: 0.45, marginBottom: 8, wordBreak: "break-all" },
      folderPath: { fontSize: 12, flex: 1, minWidth: 0, wordBreak: "break-all" },
      disabledButton: { border: "1px solid rgba(127,127,127,0.28)", background: "transparent", color: "inherit", borderRadius: 6, padding: "2px 8px", fontSize: 11, opacity: 0.5, cursor: "not-allowed", whiteSpace: "nowrap" },
      input: { flex: 1, minWidth: 0, border: "1px solid rgba(127,127,127,0.28)", background: "transparent", color: "inherit", borderRadius: 6, padding: "3px 7px", fontSize: 12, font: "inherit" },
      addRow: { display: "flex", gap: 6, padding: "6px 0 2px" },
      hint: { fontSize: 11, opacity: 0.5, margin: "2px 0 6px", lineHeight: 1.45 },
      warn: { fontSize: 11, color: "#ffb86b", margin: "2px 0 6px", lineHeight: 1.45 },
      notice: { fontSize: 11, color: "#8fd18f", margin: "2px 0 4px" },
      sectionLabel: { fontSize: 11, opacity: 0.55, margin: "10px 0 4px" },
      row: { display: "flex", alignItems: "baseline", gap: 8, padding: "3px 0", borderBottom: "1px dashed rgba(127,127,127,0.14)" },
      tag: { fontSize: 10, padding: "1px 6px", borderRadius: 999, border: "1px solid rgba(127,127,127,0.35)", opacity: 0.8, whiteSpace: "nowrap" },
      subject: { flex: 1, wordBreak: "break-word" },
      note: { fontSize: 11, opacity: 0.5, marginLeft: 2, whiteSpace: "nowrap" },
      empty: { opacity: 0.5, fontSize: 12 },
      error: { color: "#ff9a9a", fontSize: 12, padding: "6px 0" }
    };

    const STATUS_LABEL = { pending: "待办", doing: "进行中", blocked: "受阻", done: "已完成" };

    // ---------- components ----------
    function Row(props) {
      return h(
        "div",
        { style: S.row },
        props.tag !== null ? h("span", { style: S.tag }, props.tag) : null,
        h("span", { style: S.subject }, props.subject),
        props.meta !== null ? h("span", { style: S.note }, props.meta) : null
      );
    }

    /**
     * Folder block: the project's main folder (switchable) and this plugin's
     * auxiliary mounts.
     *
     * The switch does not move this conversation: it rewrites dsh-threads' project
     * record and DSH's workspace record, and DSH's workspace registry keeps the old
     * directory in memory for the life of the process. That is why the copy below
     * promises "after a restart" instead of "now".
     */
    function FoldersBlock(props) {
      const project = props.project;
      const folders = project.extraFolders || [];
      const upstream = project.upstreamFolders || [];
      const [draft, setDraft] = React.useState("");
      const [busy, setBusy] = React.useState(false);
      const [error, setError] = React.useState(null);
      const [notice, setNotice] = React.useState(null);
      const [manual, setManual] = React.useState(false);
      const [manualPath, setManualPath] = React.useState("");
      const [switched, setSwitched] = React.useState(null);

      /** Add / remove one auxiliary folder (this plugin's own record). */
      const submit = (action, path) => {
        setBusy(true);
        setError(null);
        setNotice(null);
        saveFolder(project.id, action, path).then(
          () => {
            setBusy(false);
            setNotice(action === "add" ? t("added", { path }) : t("removed", { path }));
            if (action === "add") setDraft("");
            if (typeof props.onChanged === "function") props.onChanged();
          },
          (failure) => {
            setBusy(false);
            setError(t("opFailed", { error: String((failure && failure.message) || failure) }));
          }
        );
      };

      /** Switch the project's main folder (host writer: backup, validate, roll back). */
      const switchTo = (path) => {
        setBusy(true);
        setError(null);
        setNotice(null);
        saveFolder(project.id, "main", path).then(
          (json) => {
            setBusy(false);
            if (json.changed !== true) {
              setNotice(t("unchanged"));
              return;
            }
            setSwitched({ before: json.before || "", after: json.folder, via: json.via });
            setManual(false);
            setManualPath("");
            if (typeof props.onChanged === "function") props.onChanged();
          },
          (failure) => {
            setBusy(false);
            // The host's message already names the operation and the rollback
            // ("切换主文件夹失败，已回滚到 …"); only wrap what is not.
            const message = String((failure && failure.message) || failure);
            setError(/^切换主文件夹失败|Switching the main folder failed/.test(message) ? message : t("switchFailed", { error: message }));
          }
        );
      };

      /** System folder chooser first; fall back to a typed path when unavailable. */
      const choose = () => {
        setError(null);
        setNotice(null);
        setBusy(true);
        pickFolder().then(
          (picked) => {
            if (picked === null || picked === undefined) {
              setBusy(false);
              return;
            }
            if (picked === "unavailable") {
              setBusy(false);
              setManual(true);
              setError(t("pickUnavailable"));
              return;
            }
            switchTo(picked);
          },
          (failure) => {
            setBusy(false);
            setManual(true);
            setError(t("pickFailed", { error: String((failure && failure.message) || failure) }));
          }
        );
      };

      return h(
        "div",
        null,
        h("div", { style: S.sectionLabel }, t("main")),
        h(
          "div",
          { style: S.row },
          h("span", { style: S.folderPath }, project.folder || t("unknownFolder")),
          h(
            "button",
            {
              type: "button",
              style: S.iconButton,
              disabled: busy,
              title: t("switchHint"),
              onClick: choose
            },
            busy ? t("choosing") : t("change")
          )
        ),
        h("div", { style: S.hint }, t("switchHint")),
        h(
          "div",
          { style: S.addRow },
          h("button", {
            type: "button",
            style: S.iconButton,
            disabled: busy,
            onClick: () => setManual(!manual),
            title: t("manualLabel")
          }, (manual ? "− " : "+ ") + t("manualLabel"))
        ),
        manual
          ? h(
              "div",
              { style: S.addRow },
              h("input", {
                type: "text",
                value: manualPath,
                placeholder: t("manualPlaceholder"),
                style: S.input,
                disabled: busy,
                onChange: (event) => setManualPath(event.target.value),
                onKeyDown: (event) => {
                  if (event.key === "Enter" && manualPath.trim().length > 0 && !busy) switchTo(manualPath);
                }
              }),
              h(
                "button",
                {
                  type: "button",
                  style: S.iconButton,
                  disabled: busy || manualPath.trim().length === 0,
                  onClick: () => switchTo(manualPath)
                },
                t("confirm")
              ),
              h(
                "button",
                {
                  type: "button",
                  style: S.iconButton,
                  disabled: busy,
                  onClick: () => {
                    setManual(false);
                    setManualPath("");
                    setError(null);
                  }
                },
                t("cancel")
              )
            )
          : null,
        switched !== null
          ? h("div", { style: S.notice }, t("switched", { before: switched.before || t("unknownFolder"), after: switched.after }))
          : null,
        // The boundary, in plain words: this conversation does not move.
        switched !== null
          ? h("div", { style: S.hint }, t("restartNotice", { current: switched.before || t("unknownFolder") }))
          : null,
        switched !== null && switched.via === "file" ? h("div", { style: S.warn }, t("viaFile")) : null,
        error !== null ? h("div", { style: S.error }, error) : null,
        notice !== null ? h("div", { style: S.notice }, notice) : null,
        h("div", { style: S.sectionLabel }, t("extras", { count: folders.length })),
        folders.length === 0
          ? h("div", { style: S.empty }, t("extrasEmpty"))
          : folders.map((folder) =>
              h(
                "div",
                { style: S.row, key: folder },
                h("span", { style: S.folderPath }, folder),
                h(
                  "button",
                  {
                    type: "button",
                    style: S.iconButton,
                    disabled: busy,
                    title: t("removeTitle"),
                    onClick: () => submit("remove", folder)
                  },
                  t("remove")
                )
              )
            ),
        upstream.length > 0
          ? h("div", { style: S.hint }, t("upstream", { list: upstream.join("、") }))
          : null,
        h(
          "div",
          { style: S.addRow },
          h("input", {
            type: "text",
            value: draft,
            placeholder: t("addPlaceholder"),
            style: S.input,
            disabled: busy,
            onChange: (event) => setDraft(event.target.value),
            onKeyDown: (event) => {
              if (event.key === "Enter" && draft.trim().length > 0 && !busy) submit("add", draft);
            }
          }),
          h(
            "button",
            {
              type: "button",
              style: S.iconButton,
              disabled: busy || draft.trim().length === 0,
              onClick: () => submit("add", draft)
            },
            busy ? "…" : t("add")
          )
        ),
        props.sandboxAvailable === true
          ? h("div", { style: S.hint }, t("sandboxHint"))
          : h("div", { style: S.warn }, t("sandboxWarn"))
      );
    }

    function ProjectBlock(props) {
      const project = props.project;
      const tasks = project.tasks || [];
      const threads = project.threads || [];
      return h(
        "div",
        { style: S.project },
        h("div", { style: S.projectTitle }, project.title),
        h(FoldersBlock, {
          project,
          sandboxAvailable: props.sandboxAvailable,
          onChanged: props.onChanged
        }),
        h("div", { style: S.sectionLabel }, "讨论串（" + threads.length + "）"),
        threads.length === 0
          ? h("div", { style: S.empty }, "没有进行中的讨论串")
          : threads.map((thread) =>
              h(Row, {
                key: "t" + thread.n,
                tag: "#" + thread.n,
                subject: thread.title,
                meta: thread.state + (thread.branch ? " · " + thread.branch : "")
              })
            ),
        project.hidden > 0
          ? h("div", { style: { ...S.empty, marginTop: 2 } }, "另有 " + project.hidden + " 个已解决/已归档的讨论串")
          : null,
        h("div", { style: S.sectionLabel }, "任务（" + tasks.length + "）"),
        tasks.length === 0
          ? h("div", { style: S.empty }, "还没有任务")
          : tasks.map((task) =>
              h(Row, {
                key: task.id,
                tag: task.id,
                subject: task.subject,
                meta: (STATUS_LABEL[task.status] || task.status) + (task.owner ? " · @" + task.owner : "")
              })
            )
      );
    }

    function BoardTab() {
      const board = useBoard();
      return h(
        "div",
        { style: S.root },
        h(
          "div",
          { style: S.header },
          h("span", { style: S.title }, TAB_LABEL),
          h("button", { type: "button", style: S.iconButton, onClick: board.refresh, title: "刷新" }, "刷新")
        ),
        h(
          "div",
          { style: S.body },
          board.error !== null ? h("div", { style: S.error }, "读取失败：" + board.error) : null,
          board.loading && board.projects.length === 0 ? h("div", { style: S.empty }, "读取中…") : null,
          !board.loading && board.error === null && board.projects.length === 0
            ? h("div", { style: S.empty }, "还没有 dsh-threads 项目")
            : board.projects.map((project) =>
                h(ProjectBlock, {
                  key: project.id,
                  project,
                  sandboxAvailable: board.sandbox.available === true,
                  onChanged: board.refresh
                })
              )
        )
      );
    }

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
     * rendering (a generic cube icon plus the label) with our own markup, so the
     * tab shows the plugin's own ▤ glyph at the host's text size.
     */
    function TabTitle() {
      return h(
        "span",
        { style: { display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, lineHeight: 1.2 } },
        h("span", { "aria-hidden": "true", style: { fontSize: 12 } }, TAB_ICON),
        h("span", null, TAB_TITLE)
      );
    }

    /** Small button for the session header, next to the thread-list action. */
    function HeaderAction(props) {
      return h(
        "button",
        {
          type: "button",
          title: "打开项目看板",
          onClick: () => props.openBoard(),
          style: { border: "1px solid rgba(127,127,127,0.28)", background: "transparent", color: "inherit", borderRadius: 8, padding: "3px 9px", fontSize: 12, cursor: "pointer" }
        },
        h("span", { "aria-hidden": "true" }, TAB_ICON),
        h("span", null, " " + TAB_TITLE)
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
      try {
        const locale = get("locale");
        const active = locale && typeof locale.getLocale === "function" ? locale.getLocale() : null;
        if (active && active.active) LANG = String(active.active).toLowerCase().startsWith("en") ? "en" : "zh";
      } catch {
        // no locale service: the browser language decides
      }
      const slots = get("slots");
      const tabs = get("sidebarRightTabs");
      const sidebarRight = get("sidebarRight");
      if (!slots) return;

      const openBoard = () => {
        try {
          sidebarRight && sidebarRight.openTab ? sidebarRight.openTab(TAB_KIND) : undefined;
        } catch (error) {
          try { console.warn("dsh-claude-project-ui: openTab failed", error); } catch {}
        }
      };

      try {
        if (tabs && typeof tabs.register === "function") {
          ctx.effect(() =>
            tabs.register({
              id: TAB_ID,
              kind: TAB_KIND,
              title: () => TAB_TITLE,
              guide: [
                {
                  id: "open",
                  order: 72,
                  title: () => TAB_TITLE,
                  description: () => "项目、讨论串与任务的一览",
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
            { name: "conversation.session.header.actions", id: TAB_ID, order: 16, inject: () => ({ openBoard }) },
            HeaderAction
          )
        );
      } catch (error) {
        try { console.warn("dsh-claude-project-ui: board tab not mounted:", error); } catch {}
      }
    }

    // Same Cordis rule as on the host side: a service can only be read through
    // `ctx.get` / `ctx.<name>` when it is declared here.
    return { name: "dsh-claude-project-ui", inject: ["slots", "sidebarRightTabs", "sidebarRight"], apply };
  }
});