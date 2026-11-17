// dsh-project-hub — browser half.
//
// Loaded by the DSH web GUI through window.__ModuleLoader__ (same envelope the
// official client plugins use). Registers one sidebar-footer button and the
// overlay panel behind it; the data comes from POST /project-hub/board, served
// by this package's host half.
window.__ModuleLoader__.load({
  id: "dsh-project-hub",
  factory: (require) => {
    const React = require("react");
    const h = React.createElement;

    const ROUTE = "/project-hub/board";

    // ---------- shared open/closed state between the two slots ----------
    const store = {
      open: false,
      listeners: new Set(),
      subscribe(fn) {
        store.listeners.add(fn);
        return () => store.listeners.delete(fn);
      },
      getSnapshot() {
        return store.open;
      },
      set(next) {
        if (store.open === next) return;
        store.open = next;
        for (const fn of [...store.listeners]) fn();
      }
    };

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
          cache.data = json.projects;
          cache.at = Date.now();
          return cache.data;
        })
        .finally(() => {
          cache.pending = null;
        });
      return cache.pending;
    }

    function useBoard(open) {
      const [state, setState] = React.useState({ loading: true, error: null, projects: [] });
      const refresh = React.useCallback(() => {
        setState((prev) => ({ loading: true, error: null, projects: prev.projects }));
        fetchBoard(true).then(
          (projects) => setState({ loading: false, error: null, projects }),
          (error) => setState({ loading: false, error: String((error && error.message) || error), projects: [] })
        );
      }, []);
      React.useEffect(() => {
        if (open) refresh();
      }, [open, refresh]);
      return { loading: state.loading, error: state.error, projects: state.projects, refresh };
    }

    // ---------- styles (inline: no stylesheet to load, survives theme changes) ----------
    const S = {
      button: {
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        border: "1px solid rgba(127,127,127,0.28)",
        background: "transparent",
        color: "inherit",
        borderRadius: 8,
        padding: "5px 10px",
        fontSize: 12,
        lineHeight: 1.4,
        cursor: "pointer"
      },
      overlay: {
        position: "fixed",
        top: 56,
        right: 16,
        bottom: 16,
        width: 420,
        maxWidth: "calc(100vw - 32px)",
        zIndex: 60,
        display: "flex",
        flexDirection: "column",
        borderRadius: 12,
        border: "1px solid rgba(127,127,127,0.28)",
        background: "rgba(22,24,28,0.97)",
        color: "#e8eaed",
        boxShadow: "0 18px 48px rgba(0,0,0,0.45)",
        font: "13px/1.55 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        overflow: "hidden"
      },
      header: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "10px 12px",
        borderBottom: "1px solid rgba(127,127,127,0.22)"
      },
      title: { fontWeight: 600, fontSize: 13, flex: 1 },
      iconButton: {
        border: "1px solid rgba(127,127,127,0.28)",
        background: "transparent",
        color: "inherit",
        borderRadius: 6,
        padding: "2px 8px",
        fontSize: 12,
        cursor: "pointer"
      },
      body: { overflowY: "auto", padding: "8px 12px 16px" },
      project: { marginBottom: 18 },
      projectTitle: { fontWeight: 600, fontSize: 12, opacity: 0.9, marginBottom: 2 },
      folder: { fontSize: 11, opacity: 0.45, marginBottom: 8, wordBreak: "break-all" },
      sectionLabel: { fontSize: 11, opacity: 0.55, margin: "10px 0 4px" },
      row: {
        display: "flex",
        alignItems: "baseline",
        gap: 8,
        padding: "3px 0",
        borderBottom: "1px dashed rgba(127,127,127,0.14)"
      },
      tag: {
        fontSize: 10,
        padding: "1px 6px",
        borderRadius: 999,
        border: "1px solid rgba(127,127,127,0.35)",
        opacity: 0.8,
        whiteSpace: "nowrap"
      },
      stateTag: { fontSize: 10, padding: "1px 6px", borderRadius: 999, background: "rgba(120,170,255,0.18)", whiteSpace: "nowrap" },
      subject: { flex: 1, wordBreak: "break-word" },
      note: { fontSize: 11, opacity: 0.5, marginLeft: 2 },
      empty: { opacity: 0.5, fontSize: 12 },
      error: { color: "#ff9a9a", fontSize: 12, padding: "6px 0" },
      footer: { padding: "6px 12px", borderTop: "1px solid rgba(127,127,127,0.22)", fontSize: 11, opacity: 0.55 }
    };

    const STATUS_LABEL = { pending: "待办", doing: "进行中", blocked: "受阻", done: "已完成" };

    // ---------- components ----------
    function SidebarAction() {
      const open = React.useSyncExternalStore(store.subscribe, store.getSnapshot);
      return h(
        "button",
        {
          type: "button",
          title: "项目看板：讨论串状态 + 任务",
          onClick: () => store.set(!open),
          style: { ...S.button, borderColor: open ? "rgba(120,170,255,0.65)" : S.button.borderColor }
        },
        h("span", { "aria-hidden": "true" }, "▤"),
        h("span", null, "看板")
      );
    }

    function Row(props) {
      return h(
        "div",
        { style: S.row },
        props.tag !== null ? h("span", { style: S.tag }, props.tag) : null,
        h("span", { style: S.subject }, props.subject),
        props.meta !== null ? h("span", { style: S.note }, props.meta) : null
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
        project.folder ? h("div", { style: S.folder }, project.folder) : null,
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

    function Panel(props) {
      const board = useBoard(true);
      return h(
        "div",
        { style: S.overlay, role: "dialog", "aria-label": "项目看板" },
        h(
          "div",
          { style: S.header },
          h("span", { style: S.title }, "项目看板"),
          h("button", { type: "button", style: S.iconButton, onClick: board.refresh, title: "刷新" }, "刷新"),
          h("button", { type: "button", style: S.iconButton, onClick: props.onClose, title: "关闭" }, "关闭")
        ),
        h(
          "div",
          { style: S.body },
          board.error !== null ? h("div", { style: S.error }, "读取失败：" + board.error) : null,
          board.loading && board.projects.length === 0 ? h("div", { style: S.empty }, "读取中…") : null,
          !board.loading && board.error === null && board.projects.length === 0
            ? h("div", { style: S.empty }, "还没有 dsh-threads 项目")
            : board.projects.map((project) => h(ProjectBlock, { key: project.id, project }))
        ),
        h("div", { style: S.footer }, "数据来自 POST " + ROUTE + " · 只读")
      );
    }

    function BoardOverlay() {
      const open = React.useSyncExternalStore(store.subscribe, store.getSnapshot);
      if (!open) return null;
      return h(Panel, { onClose: () => store.set(false) });
    }

    // ---------- plugin ----------
    function apply(ctx) {
      let slots;
      try {
        slots = ctx.get("slots");
      } catch {
        return;
      }
      if (slots === undefined || slots === null) return;
      try {
        slots.inject("sidebar.footer.action", () =>
          slots.register(
            { name: "sidebar.footer.action", id: "project-hub", order: 12, label: () => "看板" },
            SidebarAction
          )
        );
        slots.inject("shell.overlay", () =>
          slots.register({ name: "shell.overlay", id: "project-hub", order: 12 }, BoardOverlay)
        );
      } catch (error) {
        // A missing slot in this host generation must not break the shell.
        try {
          console.warn("dsh-project-hub: board panel not mounted:", error);
        } catch {
          /* ignore */
        }
      }
    }

    return { name: "dsh-project-hub", inject: ["slots"], apply };
  }
});
