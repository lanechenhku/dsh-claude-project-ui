# dsh-project-hub

一个 DeepSeek Harness 插件，给 [@kyf-eng/dsh-threads](https://github.com/Kyf-eng/dsh-threads) 的「项目 + 讨论串」补三件它没有的东西：

1. **项目短约定（A）** —— 少量、必须让每个讨论串都看见的约定（几十字的规则、发布口径）。索引最多列 3 条、280 字符；
   长文档、目录、PDF 的检索交给 `dsh-knowledge`（`knowledge_search`），两边不抢上下文。
2. **跨讨论串看板（B）** —— 讨论串的实时状态（来自 dsh-threads 自己的记录，只读）加上一层手动任务，所有项目会话都能看到同一份看板。
3. **上下文接续（C）** —— 一条 `context_brief` 工具/命令，把目标、项目说明、看板、知识库索引、各讨论串最近的回报拼成可直接粘进 `thread_open.task` 的简报；讨论串会话启动时也会自动收到同一份摘要，不用再靠手写 brief。

它**不修改也不依赖 dsh-threads 的模块**，只读它的存储文件来识别「这个会话属于哪个项目、是不是讨论串」；两个插件任何一个卸载，另一个都照常工作。

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

## 安装

需要 DeepSeek Harness 0.2.1-rc.2 到 0.3.0。

### 桌面 App（`desktop` profile）

**不要**用 `dsh plugin --profile desktop ...`：`desktop` profile 由 Electron 独占，命令行会被
无条件拒绝（`profile "desktop" is managed exclusively by the Electron application`），
和 App 有没有在运行无关。

两条可用路径：

1. **设置 → 插件 → 市场**，搜索 `dsh-project-hub` 安装，然后重启。
2. **手工安装**（离线或私发 tarball 时）：

```sh
# 解到 profile 的 node_modules
mkdir -p ~/.dsh/profiles/desktop/node_modules/dsh-project-hub
tar xzf dsh-project-hub-0.1.3.tgz -C /tmp/pkg
cp -R /tmp/pkg/package/. ~/.dsh/profiles/desktop/node_modules/dsh-project-hub/
```

然后编辑 `~/.dsh/profiles/desktop/package.json`：`dependencies` 里加
`"dsh-project-hub": "^0.1.3"`，`dsh.profile.bundles` 数组里追加 `"dsh-project-hub"`，
最后完全退出 DSH（⌘Q）再启动。

> 只加依赖、不加 `dsh.profile.bundles` 不会加载——DSH 只从 bundles 层挂载插件。

### 其他 profile（`web` / `tui` / 自建）

这些 profile 由 CLI 启动，可以正常用插件管理器：

```sh
dsh plugin --profile web add dsh-project-hub
```

### 卸载

桌面 App：从 `dependencies` 和 `dsh.profile.bundles` 里删掉，再删
`~/.dsh/profiles/desktop/node_modules/dsh-project-hub`，重启。
其他 profile：`dsh plugin --profile web remove dsh-project-hub`。

数据留在 `~/.dsh/project-hub/`，卸载不会删；要彻底清掉就删这个目录。

## 配置

在 profile 的 `cordis.patch.yml` 里覆盖：

```yaml
- id: dsh-project-hub
  name: "dsh-project-hub"
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
- 没有客户端 UI：看板走 `board_list` 工具和 `/hub board` 命令，不做侧栏面板。
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
