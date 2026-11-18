# dsh-claude-project-ui

**简体中文** · [English](#english)

把 **Claude Code 的 Projects + Threads 体验**搬进 DeepSeek Harness —— 在
[@kyf-eng/dsh-threads](https://github.com/Kyf-eng/dsh-threads) 之上，补出 Claude 用户熟悉的那套
项目界面、交互方式和上下文逻辑。

> 一句话：dsh-threads 给出「项目 + 讨论串」的骨架；本插件补上 Claude 用户习惯的四件事——
> **每个讨论串都懂的项目说明**、**一眼看完的看板面板**、**开新讨论串时的自动简报**、
> **跨会话的上下文接续**。

## 强化了 lead 与 thread 的分工

不只是补功能，还把这套分工调到位——**主对话当 lead，讨论串当手**：

- **主对话会主动开 thread**：默认不再先弹确认卡（`offerApproval: "open"`），判断该派活就直接派，
  开完立刻回来陪你，不等、不轮询
- **回报自动汇总**：讨论串每轮回报自动变成看板任务（按 `threadId` 幂等去重），不用手工记账
- **上下文自动交互**：项目说明、看板快照、其它讨论串的进展，每个新 thread 第一步就带上
- **并发上限 6 个讨论串**（dsh-threads 默认 3 个，满了会回「或者这件事在主对话里做」）
- 目标是把 **Claude Code（Opus 5.5 一代）**那套项目体验尽量搬过来：项目 → 讨论串 → 汇报 → 继续派活

### 让这套分工生效的两行配置

本插件不改 dsh-threads 的提示词；分工效果来自 dsh-threads 自己的 dispatcher prompt + 下面两个开关：

```yaml
- id: dsh-threads
  name: '@kyf-eng/dsh-threads'
  config:
    offerApproval: "open"   # 用户点名任务但没明说开 thread 时，直接开、不弹确认卡
    maxRunning: 6           # 同时最多 6 个讨论串（默认 3）
```

改完完全退出 DSH 再启动。

## 和 dsh-threads 的关系：补强，不是替代

| 能力 | `@kyf-eng/dsh-threads` | 本插件 `dsh-claude-project-ui` |
|---|---|---|
| 项目 / 讨论串的创建与生命周期 | ✅ 拥有 | 只读识别，绝不写它的数据 |
| 主对话当 lead、主动开 thread | ✅ 提示词 + `thread_open` | — |
| 项目级说明（每个 thread 都看到） | ❌ 只有主对话自己的 instructions | ✅ 短约定注入主对话和所有讨论串 |
| 跨 thread 的看板 | ❌ | ✅ 侧栏面板 + `/hub board` 命令 + `board_list` 工具 |
| 开 thread 时的上下文简报 | 手写 `task` 文本 | ✅ `context_brief` 一键拼好 |
| 讨论串回报汇聚成任务 | ❌ | ✅ 幂等自动汇总（按 `threadId` 去重） |
| 讨论串建好时的启动上下文 | — | ✅ 自动注入项目说明 + 看板 + 他人进展 |

两个插件通过**只读存储文件**解耦：本插件不 import dsh-threads 的模块，也不写它的存储。
任何一个卸载，另一个照常工作；dsh-threads 换存储格式时本插件静默降级为「不注入」，不会报错。

## 功能

### 知识库

| 工具 | 作用 |
|---|---|
| `kb_add` | 加一篇文档（同标题=替换）；正文可内联，也可给 `path` 读文件 |
| `kb_list` | 列出 id、标题、字数、标签 |
| `kb_search` | 中英混合检索（CJK 二元组 + 英文词），返回片段和文档 id |
| `kb_get` | 按 id 读全文，可分页（`offset`/`limit`） |
| `kb_remove` | 删除一篇 |

上限：每项目 200 篇 / 400 万字 / 单篇 40 万字（可在配置里调）。

### 看板

讨论串状态由 dsh-threads 持有，本插件只读：`#3 补文档 — 待决策 · dsh-threads/3-ab12cd`。
手动任务独立存放（`b-<n>`），可改状态 pending / doing / blocked / done。

| 工具 | 作用 |
|---|---|
| `board_add` / `board_update` | 增/改手动任务（讨论串也可以用来报自己的进度） |
| `board_list` | 合并视图：讨论串实时状态 + 手动任务 |
| `hub_note` | 记一条项目级上下文（决策、约束），所有会话可见 |

### 上下文

| 入口 | 作用 |
|---|---|
| `context_brief` 工具 / `/hub brief` | 生成项目简报，粘进 `thread_open.task` |
| 自动注入 | 每个项目会话（主对话 + 讨论串）都会收到：知识库索引、看板快照、最近进展（含其它讨论串的回报） |

### 命令

```
/hub status                  我在哪个项目、多少知识/任务
/hub board [--all]           看板（默认隐藏已解决/已归档的讨论串）
/hub task <标题>              加一条手动任务
/hub done <b-N>              把任务标记为完成
/hub rm <b-N>                删除任务
/hub doctor                  自检：数据目录、讨论串存储、注入预算
/hub kb [关键词]              知识库列表或检索
/hub brief                   项目简报
/hub note <文本>              记一条项目级上下文
/hub add <标题> | <正文>      加一篇知识库文档（正文可省略）
```

一次粘多行也可以：每条以 `/hub` 开头（或只是首行带 `/hub`），逐行执行、逐条汇报。
行尾的 `→ 说明` 会被当作注释丢掉。

## 看板面板（侧栏）

浏览器半会往**右侧栏**加一个「项目看板」页签，和 dsh-threads 的「讨论串」并列（会话头部还有一个「▤ 项目看板」按钮可以一键打开）：

- 按项目分组，列出**进行中的讨论串**（编号、标题、状态、worktree 分支）
- 列出**任务**（编号、标题、状态、负责人），含自动汇总的讨论串任务
- 默认隐藏已解决/已归档的讨论串，只提示「另有 N 个」
- 「刷新」按钮重新拉取；数据来自宿主半的 `POST /project-hub/board`，**只读**

面板只在 Web GUI（`desktop` / `web` profile）出现；`tui` / headless 没有侧栏，
退化成 `/hub board` 命令和 `board_list` 工具。

## 安装

需要 DeepSeek Harness 0.2.1-rc.2 到 0.3.0。

### 桌面 App（`desktop` profile）

**不要**用 `dsh plugin --profile desktop ...`：`desktop` profile 由 Electron 独占，命令行会被
无条件拒绝（`profile "desktop" is managed exclusively by the Electron application`），
和 App 有没有在运行无关。

两条可用路径：

1. **设置 → 插件 → 市场**，搜索 `dsh-claude-project-ui` 安装，然后重启。
2. **手工安装**（离线或私发 tarball 时）：

```sh
# 解到 profile 的 node_modules
mkdir -p ~/.dsh/profiles/desktop/node_modules/dsh-claude-project-ui
tar xzf dsh-claude-project-ui-0.2.0.tgz -C /tmp/pkg
cp -R /tmp/pkg/package/. ~/.dsh/profiles/desktop/node_modules/dsh-claude-project-ui/
```

然后编辑 `~/.dsh/profiles/desktop/package.json`：`dependencies` 里加
`"dsh-claude-project-ui": "^0.2.0"`，`dsh.profile.bundles` 数组里追加 `"dsh-claude-project-ui"`，
最后完全退出 DSH（⌘Q）再启动。

> 只加依赖、不加 `dsh.profile.bundles` 不会加载——DSH 只从 bundles 层挂载插件。

### 其他 profile（`web` / `tui` / 自建）

这些 profile 由 CLI 启动，可以正常用插件管理器：

```sh
dsh plugin --profile web add dsh-claude-project-ui
```

### 卸载

桌面 App：从 `dependencies` 和 `dsh.profile.bundles` 里删掉，再删
`~/.dsh/profiles/desktop/node_modules/dsh-claude-project-ui`，重启。
其他 profile：`dsh plugin --profile web remove dsh-claude-project-ui`。

数据留在 `~/.dsh/project-hub/`，卸载不会删；要彻底清掉就删这个目录。

## 快速开始（3 步）

装好并**完全退出 DSH 再启动**之后：

```text
/hub status        我在哪个项目、多少知识 / 任务
/hub note 发布前必须跑 node test/harness.mjs
/hub add 发布清单 | 1) 跑测试 2) npm pack 3) gh release
/hub brief         粘进 thread_open.task 的项目简报
```

右侧栏「▤ 项目看板」页签里应该能看到刚加的任务和讨论串状态；`tui` / headless 没有侧栏，用 `/hub board`。
开新讨论串时它第一步就会带上项目说明、看板快照和最近进展，不用你复制粘贴。

## 配置

在 profile 的 `cordis.patch.yml` 里覆盖：

```yaml
- id: dsh-claude-project-ui
  name: "dsh-claude-project-ui"
  config:
    dataDir: ""                      # 默认 ~/.dsh/project-hub
    threadsStorage: ""               # 默认 ~/.dsh/storages/dsh_threads.json
    knowledgeIndexMaxChars: 280
    kbIndexMaxDocs: 3
    boardContextMaxChars: 700
    digestContextMaxChars: 700
    briefMaxChars: 4000
    maxNotes: 200
    maxDocs: 200
    maxKnowledgeChars: 4000000
    hideResolvedThreads: true        # 看板与注入里隐藏已解决/已归档的讨论串
    autoConvergeReports: true        # 把讨论串回报自动汇总成看板任务（幂等）
```

| 字段 | 默认值 | 影响 |
|---|---|---|
| `dataDir` | `~/.dsh/project-hub` | 知识库 / 任务 / 笔记的根目录；换掉就是另一套项目数据 |
| `threadsStorage` | `~/.dsh/storages/dsh_threads.json` | 只读；用来识别「哪些会话属于哪个项目」，格式变了会静默降级为不注入 |
| `knowledgeIndexMaxChars` | `280` | 注入的知识库索引字符上限；调大占提示词预算，调小了只列更少文档 |
| `kbIndexMaxDocs` | `3` | 索引里最多列几篇文档，其余提示用 `kb_search` 检索 |
| `boardContextMaxChars` | `700` | 注入的看板快照字符上限 |
| `digestContextMaxChars` | `700` | 注入的「最近进展」字符上限 |
| `briefMaxChars` | `4000` | `context_brief` / `/hub brief` 的单次输出上限 |
| `maxNotes` | `200` | 每个项目保留多少条 `hub_note` 进展笔记 |
| `maxDocs` | `200` | 每个项目允许的知识库文档数 |
| `maxKnowledgeChars` | `4000000` | 每个项目知识库总字符数上限 |
| `hideResolvedThreads` | `true` | 看板与注入里隐藏已解决 / 已归档讨论串；`board_list all=true` 可看全部 |
| `autoConvergeReports` | `true` | 讨论串回报自动汇总成看板任务（按 `threadId` 幂等） |

## 数据

```
~/.dsh/project-hub/projects/<projectId>/
  knowledge.json   知识库文档
  board.json       手动任务
  notes.json       项目上下文笔记
```

全部是普通 JSON，原子写入（临时文件 + rename），可以手工备份或编辑。

## 已知限制

- 只读识别 dsh-threads 的存储文件；它的存储格式若改变，项目识别会失效（插件会静默降级为「不注入」而不是报错）。
- 知识库是**词法检索**（CJK 二元组 + 英文词 + 词频归一化），没有向量检索，也没有 LLM 摘要；文档要自己写清楚标题和关键词。
- 摘要不是模型生成的：自动部分来自 dsh-threads 的 `lastReport`，手动部分来自 `hub_note`。主对话自己没回报过的东西不会出现。
- 注入内容按字符截断（每段默认 700-900 字），不是按 token 精确计量。
- 面板是只读的：建/改/删任务目前只能用 `board_add` / `board_update` / `/hub task|done|rm`。
- 轮询刷新：每 10 秒 + agent 状态变化时刷新提示词快照，最坏情况看到的是 10 秒前的看板。
- 看板默认隐藏已解决/已归档的讨论串；想全看用 `board_list all=true` 或 `/hub board --all`。

## 验收记录（2026-11-18，本机 desktop profile）

| 层 | 结论 | 证据 |
|---|---|---|
| 命令 | 通过 | 会话日志 `command/run` + `command/done`；多行 5 条、`add \| 正文` 均生效；`knowledge.json` 落盘 |
| 工具 | 通过 | 项目主对话里模型经 PTC 调用 `tools.kb_search({query:"release"})`，返回 `[k-1] 发布清单 score=0.343` |
| 注入 | 通过（知识库） | 真实 system prompt 中出现：`本项目共享知识库（主对话和每个讨论串都会收到这份索引）。\n## 项目知识库（1 篇…）` |
| 注入（看板/进展） | 通过 | 讨论串 #2 的请求体（`user/message` 记录，12.7KB）里逐字包含 `## 项目看板`、两行讨论串状态、`## 项目进展` 段；KB 则在 `system/message` 里（section vs context 两种注入通道） |
| schema 兼容 | 通过 | `node test/spec-check.mjs` 对照宿主 DSL 校验 10 个工具定义 |
| 逻辑 | 通过 | `node test/harness.mjs` 19 项（含 changedFiles、隐藏规则、汇总幂等、/hub doctor） |

## 与 Team 模式的关系

Team 模式的任务板属于**单个会话的 subagent 树**；本插件的看板属于**一个 dsh-threads 项目**（主对话 + 它的所有讨论串）。两者互补，不会互相写入。

## License

MIT（见 [LICENSE](LICENSE)）。

---

<a id="english"></a>

# dsh-claude-project-ui (English)

Bring the **Claude Code Projects + Threads experience** to DeepSeek Harness. On top of
[@kyf-eng/dsh-threads](https://github.com/Kyf-eng/dsh-threads), this plugin adds the project UI,
the interaction model and the context logic Claude users expect.

> In one line: dsh-threads provides the "project + thread" skeleton; this plugin adds the four
> things Claude users are used to — **a project brief every thread can see**, **a board you can
> read at a glance**, **an automatic brief when a thread is opened**, and **context that carries
> over between sessions**.

## A sharper lead / thread split

This is not only extra features — it tightens the division of labour so the **main conversation leads and
threads do the hands-on work**:

- **The main conversation opens threads on its own**: with `offerApproval: "open"` it no longer asks for
  confirmation first, delegates when it judges the work belongs in a thread, and returns to you immediately
  without waiting or polling
- **Reports roll up automatically**: each thread report becomes a board task (idempotent, keyed by
  `threadId`) — no manual bookkeeping
- **Context flows without you**: project brief, board snapshot and other threads' progress are attached to
  every new thread from its first step
- **Up to 6 concurrent threads** (dsh-threads defaults to 3, and at the cap it answers "or do the work in the
  main conversation")
- The goal is to bring the **Claude Code (the Opus 5.5 generation)** project experience over as closely as
  possible: project → threads → reports → keep delegating

### The two settings that make it behave this way

This plugin does not touch dsh-threads' prompt; the behaviour comes from that plugin's own dispatcher prompt
plus these two switches:

```yaml
- id: dsh-threads
  name: '@kyf-eng/dsh-threads'
  config:
    offerApproval: "open"   # open the thread right away instead of asking first
    maxRunning: 6           # up to 6 concurrent threads (default 3)
```

Quit DSH completely and start it again after editing.
## Relationship to dsh-threads: a complement, not a replacement

| Capability | `@kyf-eng/dsh-threads` | This plugin `dsh-claude-project-ui` |
|---|---|---|
| Project / thread creation and lifecycle | ✅ owned there | Read-only detection, never writes its data |
| Main conversation as lead, opening threads | ✅ prompt + `thread_open` | — |
| Project-level instructions every thread sees | ❌ main conversation only | ✅ short rules injected into the main conversation and every thread |
| Cross-thread board | ❌ | ✅ sidebar panel + `/hub board` + `board_list` tool |
| Brief when opening a thread | hand-written `task` text | ✅ `context_brief` assembles it |
| Thread reports rolled up as tasks | ❌ | ✅ idempotent rollup keyed by `threadId` |
| Startup context for a new thread | — | ✅ project brief + board + other threads' progress |

The two plugins are decoupled through a **read-only storage file**: this plugin never imports
dsh-threads modules and never writes its storage. Uninstalling either leaves the other working; if
dsh-threads changes its storage format, this plugin silently degrades to "no injection" instead of
throwing.

## Features

### Knowledge base

| Tool | Purpose |
|---|---|
| `kb_add` | Add a document (same title = replace); inline body, or a `path` to read from disk |
| `kb_list` | List id, title, size and tags |
| `kb_search` | Mixed Chinese/English retrieval (CJK bigrams + English words); returns snippets and document ids |
| `kb_get` | Read one document by id, paginated (`offset` / `limit`) |
| `kb_remove` | Delete a document |

Limits: 200 documents, 4M characters and 400k characters per document, per project (configurable).

### Board

Thread state is owned by dsh-threads and read-only here:
`#3 write docs — needs decision · dsh-threads/3-ab12cd`. Manual tasks live separately
(`b-<n>`) with statuses pending / doing / blocked / done.

| Tool | Purpose |
|---|---|
| `board_add` / `board_update` | Create or update a manual task (threads can use it to report their own progress) |
| `board_list` | Merged view: live thread state plus manual tasks |
| `hub_note` | Record one line of project context (a decision, a constraint) visible to every session |

### Context

| Entry point | Purpose |
|---|---|
| `context_brief` tool / `/hub brief` | Compose the project brief and paste it into `thread_open.task` |
| Automatic injection | Every project session (main conversation and each thread) receives: the knowledge index, a board snapshot and recent progress from other threads |

### Commands

```
/hub status                  Which project am I in, how much knowledge / how many tasks
/hub board [--all]           The board (resolved/archived threads hidden by default)
/hub task <title>            Add a manual task
/hub done <b-N>              Mark a task done
/hub rm <b-N>                Delete a task
/hub doctor                  Self-check: data dir, thread storage, injection budget
/hub kb [query]              List the knowledge base, or search it
/hub brief                   Project brief
/hub note <text>             Record one line of project context
/hub add <title> | <body>    Add a knowledge document (body optional)
```

You can paste several lines at once: each line starts with `/hub` (or only the first line does),
and they run in order with a per-line report. A trailing `→ note` is treated as a comment.

## Board panel (sidebar)

The browser half registers a "项目看板" tab in the **right-hand sidebar pane**, next to dsh-threads' "讨论串" tab (the session header also gets a "▤ 项目看板" button that opens it):

- Projects grouped, each listing **live threads** (number, title, state, worktree branch)
- **Tasks** (id, title, status, owner), including the automatically rolled-up thread tasks
- Resolved and archived threads are hidden by default, with a "N more" note
- A "Refresh" button; data comes from the host half's `POST /project-hub/board` and is **read-only**

The panel only exists in the Web GUI (`desktop` / `web` profiles). `tui` and headless have no
sidebar and fall back to the `/hub board` command and the `board_list` tool.

## Install

Requires DeepSeek Harness 0.2.1-rc.2 through 0.3.0.

### Desktop app (`desktop` profile)

**Do not** use `dsh plugin --profile desktop ...`: that profile is owned exclusively by the
Electron app, and the CLI refuses unconditionally
(`profile "desktop" is managed exclusively by the Electron application`) whether or not the app is
running.

Two working paths:

1. **Settings → Plugins → Marketplace**, search `dsh-claude-project-ui`, install, restart.
2. **Manual install** (offline, or when handing over a tarball):

```sh
mkdir -p ~/.dsh/profiles/desktop/node_modules/dsh-claude-project-ui
tar xzf dsh-claude-project-ui-0.2.0.tgz -C /tmp/pkg
cp -R /tmp/pkg/package/. ~/.dsh/profiles/desktop/node_modules/dsh-claude-project-ui/
```

Then edit `~/.dsh/profiles/desktop/package.json`: add
`"dsh-claude-project-ui": "^0.2.0"` to `dependencies` and append `"dsh-claude-project-ui"` to
`dsh.profile.bundles`, then quit DSH completely (⌘Q) and start it again.

> Adding the dependency without the `dsh.profile.bundles` entry does not load the plugin — DSH
> only mounts plugins from the bundles layer.

### Other profiles (`web` / `tui` / custom)

Those are started from the CLI, so the plugin manager works normally:

```sh
dsh plugin --profile web add dsh-claude-project-ui
```

### Uninstall

Desktop app: remove it from `dependencies` and `dsh.profile.bundles`, delete
`~/.dsh/profiles/desktop/node_modules/dsh-claude-project-ui`, restart.
Other profiles: `dsh plugin --profile web remove dsh-claude-project-ui`.

Data stays in `~/.dsh/project-hub/`; uninstalling does not delete it.

## Quick start (3 steps)

After installing and **quitting DSH completely and starting it again**:

```text
/hub status        which project am I in, how much knowledge / how many tasks
/hub note release gate is node test/harness.mjs
/hub add release checklist | 1) run tests 2) npm pack 3) gh release
/hub brief         a project brief to paste into thread_open.task
```

The "▤ 项目看板" tab in the right pane should now show the task and thread state you just added; `tui` / headless
have no sidebar, so use `/hub board` there. When you open a new thread it starts with the project brief, the board
snapshot and recent progress already attached.

## Configuration

Override in the profile's `cordis.patch.yml`:

```yaml
- id: dsh-claude-project-ui
  name: "dsh-claude-project-ui"
  config:
    dataDir: ""                      # default ~/.dsh/project-hub
    threadsStorage: ""               # default ~/.dsh/storages/dsh_threads.json
    knowledgeIndexMaxChars: 280
    kbIndexMaxDocs: 3
    boardContextMaxChars: 700
    digestContextMaxChars: 700
    briefMaxChars: 4000
    maxNotes: 200
    maxDocs: 200
    maxKnowledgeChars: 4000000
    hideResolvedThreads: true        # hide resolved/archived threads in the board and injection
    autoConvergeReports: true        # roll thread reports up into board tasks (idempotent)
```

| Field | Default | Effect |
|---|---|---|
| `dataDir` | `~/.dsh/project-hub` | Root for knowledge, tasks and notes; pointing it elsewhere gives you a separate set of projects |
| `threadsStorage` | `~/.dsh/storages/dsh_threads.json` | Read-only; used to tell which sessions belong to a project. A format change degrades to "no injection" |
| `knowledgeIndexMaxChars` | `280` | Character cap for the injected knowledge index |
| `kbIndexMaxDocs` | `3` | How many documents the index lists before pointing at `kb_search` |
| `boardContextMaxChars` | `700` | Character cap for the injected board snapshot |
| `digestContextMaxChars` | `700` | Character cap for the injected recent-progress digest |
| `briefMaxChars` | `4000` | Cap for one `context_brief` / `/hub brief` result |
| `maxNotes` | `200` | Progress notes kept per project |
| `maxDocs` | `200` | Knowledge documents allowed per project |
| `maxKnowledgeChars` | `4000000` | Total knowledge characters allowed per project |
| `hideResolvedThreads` | `true` | Hide resolved / archived threads from the board and injection; `board_list all=true` shows everything |
| `autoConvergeReports` | `true` | Mirror thread reports onto the board as tasks (idempotent by `threadId`) |

## Data

```
~/.dsh/project-hub/projects/<projectId>/
  knowledge.json   knowledge documents
  board.json       manual tasks
  notes.json       project context notes
```

Plain JSON, written atomically (temp file + rename); safe to back up or edit by hand.

## Known limitations

- Project detection reads dsh-threads' storage file. If that format changes, detection breaks and
  the plugin silently degrades to "no injection" rather than erroring.
- Retrieval is **lexical** (CJK bigrams + English words + term-frequency normalisation): no vector
  search and no LLM summarisation, so write clear titles and keywords.
- Summaries are not model-generated: the automatic part comes from dsh-threads' `lastReport`, the
  manual part from `hub_note`. Nothing the main conversation never reported will show up.
- Injection is truncated by characters (700–900 per section by default), not by tokens.
- The panel is read-only: creating, changing or deleting tasks today means `board_add` /
  `board_update` / `/hub task|done|rm`.
- Refreshes are polled: every 10 seconds plus on agent status changes, so a snapshot can be up to
  10 seconds stale.
- The board hides resolved/archived threads by default; use `board_list all=true` or
  `/hub board --all` to see everything.

## Verification record (2026-11-18, local desktop profile)

| Layer | Result | Evidence |
|---|---|---|
| Commands | Pass | Session log `command/run` + `command/done`; a 5-line paste and `add \| body` both worked; `knowledge.json` written |
| Tools | Pass | In the project's main conversation the model called `tools.kb_search({query:"release"})` through PTC; returned `[k-1] release checklist score=0.343` |
| Injection (knowledge) | Pass | Real system prompt contained the shared-knowledge section |
| Injection (board/progress) | Pass | Thread #2's request body (`user/message`, 12.7 KB) contained `## 项目看板`, two thread rows and `## 项目进展` verbatim; knowledge rode in `system/message` (section vs context channels) |
| Schema compatibility | Pass | `node test/spec-check.mjs` validates all 10 tool definitions against the host DSL |
| Logic | Pass | `node test/harness.mjs`, 19 checks (changedFiles, hiding rules, rollup idempotency, `/hub doctor`) |

## Relationship to Team mode

A Team-mode task board belongs to **one session's subagent tree**; this plugin's board belongs to
**one dsh-threads project** (main conversation plus all of its threads). They complement each other
and never write to the same place.

## License

MIT — see [LICENSE](LICENSE).
