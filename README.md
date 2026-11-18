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
| 辅助文件夹（多目录挂载） | PR #61 在做，未发布 | ✅ 本插件自己存 + 提示注入 + 沙箱可写根 |
| 切换项目主文件夹 | PR #61 在做，未发布 | ✅ 本插件实现（写 dsh-threads 记录 + DSH workspace 记录，重启后新会话生效） |

两个插件通过**存储文件 + storage-domain 写链**解耦：本插件不 import dsh-threads 的模块，平时只读它的存储；
只有「切换主文件夹」这一条写路径（`src/mainfolder.js`）会动它的项目记录和 DSH 的 workspace 记录，
而且走 dsh-threads 已经打开的 domain 句柄、带备份与回滚。任何一个卸载，另一个照常工作；
dsh-threads 换存储格式时本插件静默降级为「不注入」，不会报错。

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
/hub folders [add|rm <路径>]  辅助文件夹：列出 / 挂载 / 移除
/hub folder [<路径>]         看 / 切换项目主文件夹（当前对话不动，重启后新会话才用新目录）
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

## 辅助文件夹（多目录挂载）

一个项目除了主文件夹，还可以挂载多个**辅助文件夹**（类似 Claude Code 的 additional directories）。
在右侧「▤ 项目看板」页签里按项目增删，也可以用命令：

```text
/hub folders                 列出已挂载的辅助文件夹
/hub folders add <绝对路径>   挂载一个（也接受 ~/ 开头的写法）
/hub folders rm <绝对路径>    移除一个
```

行为与边界：

- **存本插件自己的数据**：`projects/<id>/folders.json`。绝不写 dsh-threads 的 `dsh_threads.json`，
  两边各管各的存储，删掉任一插件另一边照常读。
- 路径落盘前归一化为**物理绝对路径**（`realpath`）：DSH 沙箱不接受用 symlink 拼写的额外根，
  非目录 / 读不到的路径直接拒绝。
- **系统提示**给每个项目会话（主对话 + 每个讨论串）列出挂载目录（`project-hub/folders` section）。
- **沙箱**：宿主半对项目里每个存活会话调用 `ctx.sandboxPolicy.registerWritableRoot(session, dir)`，
  所以 `workspace-write` 下核心文件工具与 bash 都能写这些目录。授权是**运行时、按会话**的：
  重启 / resume / fork 后由 10 秒的刷新循环重新登记；`read-only` 不授予写权限；
  Windows 上进程隔离不认额外根（只有 harness 的文件工具认）。
- **我们自己的文件工具认这些目录**：`kb_add` 的 `path` 只允许主文件夹和已挂载目录里的文件，
  其它路径会报错并列出当前可用的挂载（它用插件自己的权限读盘，所以这条校验必须自己兜住）。
- 授不到沙箱根时（宿主没有 `sandboxPolicy` 服务、目录被删、或不是目录）面板会**明确标注**，
  不会假装挂载可用。

## 切换主文件夹（重启后生效）

面板里「主文件夹」那一行的「切换文件夹…」按钮（或 `/hub folder <绝对路径>`）会打开系统的文件夹选择器；
没有选择器时可以在同一块里手填绝对路径。选完之后：

- **两处记录一起改，缺一不写**：
  - `~/.dsh/storages/dsh_threads.json` → `tables.projects[<id>].folder`：dsh-threads 渲染那栏 UI 用它，本插件面板也直接读它（不另存一份真相）；
  - `~/.dsh/storages/workspace.json` → `tables.workspaces[<workspaceId>].path`：**新会话的目录是从这里读的**。
    只改第一处会出现「面板显示新目录、新会话还在旧目录」的假切换，所以第二处写不进去时整次切换直接失败、什么都不改。
- **写之前备份**：两个存储文件各留一份 `<文件>.bak-mainfolder-<时间戳>`；
  写入走 dsh-threads / DSH 已经打开的那个 storage-domain（内存态是权威、写链串行），
  宿主没暴露该服务时退化为「重新读取 → 原子 rename」，并在面板上标注这次是直写文件。
- **校验**：目标必须存在且是目录，`realpath` 归一化（去尾斜杠、解 symlink）；
  拒绝 `/`、`/Applications`、`/System`、`/Library`、`/usr` 等系统目录，拒绝用户主目录本身、
  `~/.dsh`（含子目录）、`~/.ssh` 与本插件自己的数据目录；目标目录已被另一个 DSH workspace 占用时也拒绝
  （否则 DSH 启动时的 workspace 一致性检查会失败）。
- **失败不静默**：写后读回校验，不一致或中途抛错就回滚两处记录，并把原因（含备份路径）显示在面板上。
- **生效边界（实话）**：DSH 把 workspace 记录缓存在进程内存里，所以

  > **新会话和新讨论串要等 DeepSeek Harness 重启之后才用新文件夹；当前这个对话在你重启前仍留在原目录。**

  本插件的写入路径从不改活动会话的工作目录（`src/mainfolder.js` 里只写那两条记录），这就是「当前对话不动」的由来。
  面板与 `/hub folder` 的文案都按这个语义写，不会说「立即生效」。
- **耦合风险**：`dsh_threads`/`workspace` 的 domain 名与字段是 dsh-threads 和 DSH 的私有契约；
  上游 PR #61 合并后应改用它提供的官方入口。字段变了会在切换时直接报错并回滚（不会写坏记录）。
  详见 [`docs/folders-feasibility.md`](docs/folders-feasibility.md)。

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
    workspaceStorage: ""             # 默认与 threadsStorage 同目录的 workspace.json（切换主文件夹时写）
    knowledgeIndexMaxChars: 280
    kbIndexMaxDocs: 3
    boardContextMaxChars: 700
    digestContextMaxChars: 700
    maxExtraFolders: 8               # 一个项目最多挂载几个辅助文件夹
    foldersContextMaxChars: 600      # 注入的挂载目录列表字符上限
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
| `threadsStorage` | `~/.dsh/storages/dsh_threads.json` | 只读；用来识别「哪些会话属于哪个项目」，格式变了会静默降级为不注入。切换主文件夹时这一处也会被写（见上） |
| `workspaceStorage` | 与 `threadsStorage` 同目录的 `workspace.json` | 只在切换主文件夹时写：新会话的目录来自这里的 `workspaces[].path`；指错会让切换失败并回滚 |
| `knowledgeIndexMaxChars` | `280` | 注入的知识库索引字符上限；调大占提示词预算，调小了只列更少文档 |
| `kbIndexMaxDocs` | `3` | 索引里最多列几篇文档，其余提示用 `kb_search` 检索 |
| `boardContextMaxChars` | `700` | 注入的看板快照字符上限 |
| `digestContextMaxChars` | `700` | 注入的「最近进展」字符上限 |
| `maxExtraFolders` | `8` | 一个项目最多挂载几个辅助文件夹 |
| `foldersContextMaxChars` | `600` | 注入的辅助文件夹列表字符上限 |
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
  folders.json     辅助文件夹挂载（本插件自己的记录）
```

全部是普通 JSON，原子写入（临时文件 + rename），可以手工备份或编辑。

切换主文件夹不改这里，而是改 `~/.dsh/storages/dsh_threads.json` 与 `~/.dsh/storages/workspace.json`
（写前各留一份 `*.bak-mainfolder-<时间戳>`）。

## 已知限制

- 只读识别 dsh-threads 的存储文件；它的存储格式若改变，项目识别会失效（插件会静默降级为「不注入」而不是报错）。
- 知识库是**词法检索**（CJK 二元组 + 英文词 + 词频归一化），没有向量检索，也没有 LLM 摘要；文档要自己写清楚标题和关键词。
- 摘要不是模型生成的：自动部分来自 dsh-threads 的 `lastReport`，手动部分来自 `hub_note`。主对话自己没回报过的东西不会出现。
- 注入内容按字符截断（每段默认 700-900 字），不是按 token 精确计量。
- 面板除了**辅助文件夹增删**和**主文件夹切换**以外是只读的：建/改/删任务目前只能用
  `board_add` / `board_update` / `/hub task|done|rm`。
- 主文件夹切换依赖 `dsh_threads` / `workspace` 两个 storage domain 的私有字段（dsh-threads 与 DSH 的契约）。
  上游 PR #61 合并后应改用它提供的入口；字段变了对不上时切换会报错并回滚，不会静默写坏。
- 主文件夹切换**当前对话不搬家**：只有重启 DSH 之后新建的会话 / 讨论串才用新目录；面板与 `/hub folder` 都这么写。
- 辅助文件夹的沙箱授权只在 `workspace-write` 生效；`read-only` 下核心工具本来就写不了。
  授权是运行时状态，重启 / resume 后需要重新登记（刷新循环会自动做，最多延迟 10 秒）。
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
| 逻辑 | 通过 | `node test/harness.mjs` 30 项（含 changedFiles、隐藏规则、汇总幂等、/hub doctor、extraFolders 持久化 / 提示注入 / kb_add 目录校验 / 文件夹路由鉴权、主文件夹切换（两处记录 / 备份 / 拒绝非法路径 / 并发不丢数据 / 回滚）/ `/hub folder` / 路由） |

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
| Auxiliary folders (additional directories) | PR #61, unreleased | ✅ own record + prompt list + sandbox writable roots |
| Switching the project main folder | PR #61, unreleased | ✅ implemented here (writes the dsh-threads project record + the DSH workspace record; new sessions follow after a restart) |

The two plugins are decoupled through **storage files plus a storage-domain write chain**: this plugin
never imports dsh-threads modules and normally only reads its storage. Exactly one write path —
switching the main folder (`src/mainfolder.js`) — touches dsh-threads' project record and DSH's
workspace record, through the domain handle dsh-threads already opened, with a backup and a rollback.
Uninstalling either leaves the other working; if dsh-threads changes its storage format, this plugin
silently degrades to "no injection" instead of throwing.

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
/hub folders [add|rm <path>] Auxiliary folders: list / mount / unmount
/hub folder [<path>]         Show / switch the project main folder (this conversation stays put; new sessions after a restart)
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

## Mounted folders (additional directories)

A project can mount extra **auxiliary folders** on top of its main folder (Claude Code's additional
directories idea). Add or remove them per project in the "▤ 项目看板" tab, or by command:

```text
/hub folders                 list mounted folders
/hub folders add <path>      mount one (absolute, or ~/…)
/hub folders rm <path>       unmount one
```

Behaviour and boundaries:

- **This plugin's own record**: `projects/<id>/folders.json`. It never writes dsh-threads'
  `dsh_threads.json`; each plugin owns its data and removing either leaves the other readable.
- Paths are stored as **physical absolute paths** (`realpath`): the DSH sandbox rejects an extra
  root spelled through a symlink; missing or non-directory paths are refused.
- **System prompt**: every project session (main conversation and each thread) gets the mount list
  as a `project-hub/folders` section.
- **Sandbox**: the host half calls `ctx.sandboxPolicy.registerWritableRoot(session, dir)` for every
  live session of the project, so under `workspace-write` the core file tools and bash can write
  those directories. Grants are runtime-only and per session: the 10-second sweep re-registers them
  after a restart / resume / fork. `read-only` grants no writes; on Windows process confinement
  ignores extra roots (the harness file tools honour them).
- **Our own file tool honours them**: `kb_add`'s `path` accepts files under the main folder and
  the mounted folders only; any other path fails with the available mounts listed (it reads with the
  plugin's own rights, so it enforces the boundary itself).
- When a grant cannot be made (no `sandboxPolicy` service, a deleted directory, a non-directory),
  the panel says so explicitly instead of pretending the mount works.

## Switching the main folder (effective after a restart)

The "Change folder…" button on the main-folder row (or `/hub folder <absolute path>`) opens the
system folder chooser; type a path in the same block when no chooser is available. Then:

- **Two records move together, or nothing does**:
  - `~/.dsh/storages/dsh_threads.json` → `tables.projects[<id>].folder`: what dsh-threads renders and
    what this panel reads directly (no second copy of the truth here);
  - `~/.dsh/storages/workspace.json` → `tables.workspaces[<workspaceId>].path`: **a new session's
    directory is read from here**. Writing only the first one would show a new folder while new
    sessions still opened the old one; so when the second write cannot be made, the whole switch fails
    and nothing changes.
- **Backup first**: each storage file gets a `<file>.bak-mainfolder-<timestamp>` copy. Writes go
  through the storage domain dsh-threads / DSH already opened (authoritative memory, serialised write
  chain); when the host exposes no such service the writer degrades to "re-read → atomic rename" and
  the panel says this switch wrote the files directly.
- **Validation**: the target must exist and be a directory and is canonicalised (`realpath`, no
  trailing slash, symlinks resolved). `/`, `/Applications`, `/System`, `/Library`, `/usr` and the
  other system roots are refused, as are the home directory itself, `~/.dsh` (and anything under it),
  `~/.ssh` and this plugin's own data directory. A directory another DSH workspace already claims is
  refused too (DSH's startup consistency check would fail).
- **No silent failure**: the writer reads both records back, and on any mismatch or error it rolls
  both back and shows the reason (including the backup paths) in the panel.
- **What actually changes, honestly**: DSH caches workspace records in process memory, therefore

  > **New sessions and threads use the new folder only once DeepSeek Harness restarts; this
  > conversation stays in its original folder until then.**

  The write path never touches a live session's working directory (it only writes those two records),
  which is exactly why the current conversation does not move. The panel and `/hub folder` say so;
  neither claims the switch is immediate.
- **Coupling risk**: the `dsh_threads` / `workspace` domain names and fields are dsh-threads' and
  DSH's private contracts. Once upstream PR #61 lands, this should switch to its official entry point.
  If a field stops matching, the switch fails and rolls back instead of corrupting a record.
  See [`docs/folders-feasibility.md`](docs/folders-feasibility.md).

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
    workspaceStorage: ""             # default: workspace.json next to threadsStorage (written on a folder switch)
    knowledgeIndexMaxChars: 280
    kbIndexMaxDocs: 3
    boardContextMaxChars: 700
    digestContextMaxChars: 700
    maxExtraFolders: 8               # auxiliary folders a project may mount
    foldersContextMaxChars: 600      # cap for the injected mount list
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
| `threadsStorage` | `~/.dsh/storages/dsh_threads.json` | Read-only for detection; also written when the main folder is switched (see above). A format change degrades to "no injection" |
| `workspaceStorage` | `workspace.json` next to `threadsStorage` | Written only on a folder switch: a new session's directory comes from `workspaces[].path` here; a wrong value makes the switch fail and roll back |
| `knowledgeIndexMaxChars` | `280` | Character cap for the injected knowledge index |
| `kbIndexMaxDocs` | `3` | How many documents the index lists before pointing at `kb_search` |
| `boardContextMaxChars` | `700` | Character cap for the injected board snapshot |
| `digestContextMaxChars` | `700` | Character cap for the injected recent-progress digest |
| `maxExtraFolders` | `8` | Auxiliary folders a project may mount |
| `foldersContextMaxChars` | `600` | Character cap for the injected auxiliary-folder list |
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
  folders.json     auxiliary folder mounts (this plugin's own record)
```

Plain JSON, written atomically (temp file + rename); safe to back up or edit by hand.

A main-folder switch does not touch this directory: it writes `~/.dsh/storages/dsh_threads.json` and
`~/.dsh/storages/workspace.json`, keeping a `*.bak-mainfolder-<timestamp>` copy of every file it changes.

## Known limitations

- Project detection reads dsh-threads' storage file. If that format changes, detection breaks and
  the plugin silently degrades to "no injection" rather than erroring.
- Retrieval is **lexical** (CJK bigrams + English words + term-frequency normalisation): no vector
  search and no LLM summarisation, so write clear titles and keywords.
- Summaries are not model-generated: the automatic part comes from dsh-threads' `lastReport`, the
  manual part from `hub_note`. Nothing the main conversation never reported will show up.
- Injection is truncated by characters (700–900 per section by default), not by tokens.
- The panel is read-only apart from **adding/removing auxiliary folders** and **switching the main
  folder**: creating, changing or deleting tasks today means `board_add` / `board_update` /
  `/hub task|done|rm`.
- Switching the main folder depends on the private fields of two storage domains (`dsh_threads` and
  `workspace`). Once upstream PR #61 lands this should move to its entry point; if a field stops
  matching, the switch errors out and rolls back rather than corrupting a record.
- Switching the main folder does **not** move the current conversation: only sessions and threads
  created after a DSH restart use the new directory, and the panel plus `/hub folder` say exactly that.
- Auxiliary folder grants only take effect under `workspace-write`; `read-only` grants nothing.
  Grants are runtime state that must be re-registered after a restart / resume (the sweep does it,
  so it can lag up to 10 seconds).
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
| Logic | Pass | `node test/harness.mjs`, 30 checks (changedFiles, hiding rules, rollup idempotency, `/hub doctor`, extraFolders persistence / prompt injection / kb_add path boundary / folder route auth, main-folder switch (both records, backup, refused paths, concurrent writes, rollback), `/hub folder`, the route) |

## Relationship to Team mode

A Team-mode task board belongs to **one session's subagent tree**; this plugin's board belongs to
**one dsh-threads project** (main conversation plus all of its threads). They complement each other
and never write to the same place.

## License

MIT — see [LICENSE](LICENSE).
