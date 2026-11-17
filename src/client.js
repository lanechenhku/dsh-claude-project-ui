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
          cache.data = json.projects;
          cache.at = Date.now();
          return cache.data;
        })
        .finally(() => {
          cache.pending = null;
        });
      return cache.pending;
    }

    function useBoard() {
      const [state, setState] = React.useState({ loading: true, error: null, projects: [] });
      const refresh = React.useCallback(() => {
        setState((prev) => ({ loading: true, error: null, projects: prev.projects }));
        fetchBoard(true).then(
          (projects) => setState({ loading: false, error: null, projects }),
          (error) => setState({ loading: false, error: String((error && error.message) || error), projects: [] })
        );
      }, []);
      React.useEffect(() => {
        refresh();
      }, [refresh]);
      return { loading: state.loading, error: state.error, projects: state.projects, refresh };
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
            : board.projects.map((project) => h(ProjectBlock, { key: project.id, project }))
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
