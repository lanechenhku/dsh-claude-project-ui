# Changelog

## 0.4.1 — 2026-11-18

**弹窗真的在最上层 + 弹窗信息结构重做**（0.4.0 的真机反馈）。仍是 0.4.x，只改浏览器半的弹窗与文案。

- **置顶问题（修复根因）**：0.4.0 的弹窗只写了 `position: fixed; z-index: 9999`，但父级若有
  `transform` / `filter` / `contain` / `isolation` 就会形成新的层叠上下文，9999 只在该上下文内部有效，
  所以会被面板或 dsh-threads 自己的 Modal 压住。现在弹窗通过 **React portal** 挂到
  `document.body` 下的专用容器 `#project-hub-dialog-root`（`role="dialog"` / `aria-modal="true"` /
  `aria-labelledby` 指向标题），彻底离开宿主的层叠上下文。找不到 `react-dom` 或没有 `document` 时
  退回原地渲染（不会消失）。打开时锁 `body` 滚动、恢复原值；**Esc** 关闭、**点遮罩**关闭。
- **弹窗信息结构（照着用户给的结构重做）**：
  - 头部：项目名（粗体）→ 浅色小字「当前主文件夹」→ 路径（monospace、单行省略、hover 显示全路径）；
    右上 `✕`。
  - 主文件夹行：`[更换…]` 主按钮 + 小链接「手动输入路径」（点了才出现输入框，不再常驻第二个按钮）。
  - 分隔线。
  - 辅助文件夹：标题 + 数量徽标；为空只有一行浅灰提示；非空每行 = 文件夹图标（内联 SVG）+ 路径
    （mono、省略）+ 右侧 `[移除]`；下面是输入框 + `[添加]`（placeholder 保持「绝对路径，或 ~/开头」）。
  - 底部**一行**浅灰脚注（沙箱可写根 + 写入 dsh-threads 记录 + 其面板重启后同步）。
  - 成功反馈：受影响那一行右侧出现 2 秒「已保存」（`role="status"`），不再有 toast / alert / 大段说明。
  - 说明文字从两大段砍到一行脚注，其余解释性长句移到 README。
- **弹窗读实时数据**：弹窗内的项目/工作区对象改为从看板快照里按 id 取最新一份，
  增删辅助文件夹后列表立即更新（不再需要关掉再打开）。
- **双语**：新增/改写的弹窗文案 zh/en 同时补齐（两张表各 79 个 key）；
  面板除订阅 `locale/change` 事件外，**同时订阅 locale 服务的快照**，语言一换就重渲染 ——
  不是挂载时读一次 `<html lang>`。测试新增四条：locale 服务切换后语言与文案跟着变、
  文案表与调用点一致（没有未用 key、也没有用到不存在的 key）、弹窗容器只创建一次且角色正确、
  三个入口都只走同一个弹窗。
- **文档**：新增 [`docs/dialog-redesign-0.4.1.md`](docs/dialog-redesign-0.4.1.md)（新旧结构对比 + 只能真机验的项）；
  README 补「文件夹弹窗」与「如何切语言」两节。
- **看板设置入口（⚙，并入 0.4.1）**：面板头部「刷新」左边新增 ⚙，用**同一套 portal** 打开 360 宽的紧凑
  设置面板（不是全屏弹窗）。六项：语言（跟随应用（中文）/ 中文 / English，手动选择优先于应用语言）、
  显示已解决 / 已归档的讨论串（默认关）、自动把讨论串回报汇总成任务（默认开）、「其他项目」卡片默认
  折叠 / 展开、排序（最近活动 / 名称）、项目文件夹管理…。
  - **存储**：新增 `src/settings.js` + `ProjectStore` 的全局读写，存 `<dataDir>/settings.json`
    （默认 `~/.dsh/project-hub/settings.json`），**不写 dsh-threads 的存储**；越界值夹回默认，写入串行化。
  - **立刻生效**：客户端 store 改完立刻重渲染 + 写入；宿主半下次快照用新值。其中「隐藏讨论串」与
    「回报汇总」是**宿主侧**行为（快照过滤 + sweep），两条路径读同一份设置，不是前端假装。
  - **语言优先级**：手动 `zh`/`en` > locale 服务 > `<html lang>`/navigator > `en`；
    「跟随应用（中文）」括号里显示当前应用语言。
  - **管理页链接**：DSH 没有公开「打开设置页某个分节」的客户端 API（核实 `dsh-client-ui-settings-general`：
    shell store 是槽位内部状态，未导出服务），所以它在同一面板里渲染**同一个** `SettingsSection`
    组件（宽 460），不假装跳转。
  - **配置项定位变化**：`hideResolvedThreads` / `autoConvergeReports` 现在是**初始默认值**，一旦在 ⚙ 里改过就以
    设置文件为准。
  - 新增测试 5 条（语言覆盖优先级、客户端设置归一化、宿主设置往返与夹取、隐藏讨论串确实是宿主侧过滤、
    同一时间只开一个浮层且写入失败会回滚），`npm test` 共 52 条。

## 0.4.0 — 2026-11-18

**看板版式重做 + 真正的双语 + 文件夹的三个入口**。看板从「一堆项目平铺」变成两层结构；
面板/弹窗/设置页的文案全部抽成 zh/en 两套并跟随 DSH 的 locale 服务；改文件夹新增看板、设置页、
dsh-threads 面板三处入口，共用一套组件与一条写入路径。

- **看板版式（浏览器半，`src/client.js`）**：
  - 当前项目置顶：独立卡片 + 左侧 3px 强调色竖条 + 名称 + monospace 11 路径；右上「切换文件夹⋯」+
    展开箭头；卡片内是「辅助文件夹」折叠区。
    「当前项目」由宿主半解析：面板把所在对话的 session id 发到 `POST /project-hub/board`，
    宿主用 `registry.roleOf(sessionId)` 找到项目并回填 `currentProjectId`；解析不出来就不置顶。
  - 当前卡片与其余项目之间是一条 2px 粗分隔 + 文字「其他项目 · N」（`Other projects · N`），
    **滚动吸顶**（`position: sticky`）。
  - 其余项目按**最近活动时间**倒序（宿主在快照里给每个项目算 `activity` = 项目记录与所有讨论串里最新的那个），
    紧凑卡片（名称 + 讨论串/任务数量 + 最近活动）默认收起，点开才展开讨论串与任务行；
    卡片之间 1px 细线 + 12px 间距。
  - 讨论串行 = 6px 状态点 + `#编号` + 单行省略标题 + 右侧状态词；任务行 = 状态 pill + 任务号 + 主题 +
    右侧「+」复制任务号（配合 `/hub done <id>`）。空状态只有一行浅色提示。
  - 视觉规范：8px 网格、圆角 10、边框 `rgba(127,127,127,0.18)`、hover `rgba(127,127,127,0.06)`、
    无大阴影、字号 12/13、monospace 11；状态点颜色 进行中=蓝、待办=灰、受阻/待决策=橙、
    已完成/已解决=绿、空闲/已停止=浅灰。
  - 讨论串状态改用**稳定 code**（`threadStateCode()` 新增在 `src/project.js`），
    `boardView()` 额外返回 `code`，面板据此翻译（不再把中文状态词直接显示在英文界面里）。
- **双语**：`src/client.js` 里 `MESSAGES.zh` / `MESSAGES.en` 各 93 个 key，覆盖面板、弹窗、设置页、
  注入按钮的**全部**文案。语言读 DSH 的 locale 服务（`ctx.locale.getLocale()` + `ctx.on("locale/change")`，
  并用 `ctx.locale.register("project-hub", { zh, en })` 登记字典）；切换语言立即生效。
  **缺 key 回退顺序：当前语言 → 英文 → 中文 → key**。客户端 `inject` 因此新增 `locale`。
- **入口 A（看板内）**：当前项目卡片的「切换文件夹⋯」打开共用弹窗；卡片内的「辅助文件夹」折叠区可以增删挂载。
- **入口 B（设置页）**：`slots.inject("settings.section")` 注册「项目文件夹 / Project folders」分节，
  列出**所有项目与工作区**，逐行显示路径 + 修改按钮 + 辅助文件夹数量；**只做逐个修改，没有批量改全部**。
  已被项目占用的工作区不能单独改（会被拒绝并提示去项目那一行改）。
  新增 `src/workspaces.js`（工作区只读视图 + 与项目的 join）与 `src/mainfolder.js` 的
  `setWorkspaceFolder()`（复用同一条备份 / realpath / 串行 / 回滚纪律，只动 `workspace.json`）；
  `POST /project-hub/folders` 新增 `action: "workspace"`。
- **入口 C（注入 dsh-threads 面板）**：`MutationObserver` 找 dsh-threads「项目设置 → 通用 → 文件夹」
  卡片里的 `.dsht-setting-path` 锚点，注入「⚙ 更多文件夹⋯」按钮，点击打开同一个弹窗（按路径认领项目）。
  找不到锚点静默不注入；重复触发幂等（一个卡片只有一个按钮）；所有 DOM 操作 `try/catch`，
  结构变化最多掉按钮，不抛到宿主、不白屏。
- **共用弹窗**：`shell.overlay` 里挂一个 `FolderDialog`，A/B/C 三处都打开它（Esc / 点遮罩关闭）；
  文件夹表单与看板内嵌的是**同一个组件**（`FolderForm`）。三处都写明
  「改动会写入 dsh-threads 的项目记录与 workspace 记录；dsh-threads 自己的设置面板要重启后才同步显示」。
- **宿主半**：`boardSnapshot()` 接受 `sessionId` 并额外返回 `currentProjectId`、`workspaces`、
  每个项目的 `activity` 与 `workspaceId`；`project.js` 透出 `workspaceId` 并新增 `projectActivity()`。
- **测试**：新增 `test/client-checks.mjs`（11 条浏览器半检查：i18n 两侧 key 一致 / 缺 key 回退英文 /
  当前项目置顶与活跃度排序 / 相对时间 / 状态色 / 路径认领 / 注入幂等与降级 / `apply` 注册五种 slot 且
  没有 DOM 也不抛），`test/harness.mjs` 新增「看板快照形状」「工作区写入与拒绝」两组宿主检查。
  `npm test` 共 43 条全绿，`npm run prepublishOnly` 里的 `spec-check` 也通过。

## 0.3.0 — 2026-11-18

新增**辅助文件夹（多目录挂载）**与**项目主文件夹切换**：一个项目除主文件夹外可以挂多个目录，提示词、
沙箱授权、本插件自己的文件工具三条都通；主文件夹可以在面板或 `/hub folder` 里真的切换
（写入 dsh-threads 的项目记录 + DSH 的 workspace 记录，**当前对话不动、重启后新会话跟随**）。

- 新增 `src/folders.js`：挂载列表存本插件自己的 `projects/<id>/folders.json`（**不写** dsh-threads 的
  `dsh_threads.json`，两边各管各的存储）；路径落盘前 `realpath` 归一化为物理绝对路径
  （DSH 沙箱不接受 symlink 拼写的额外根），非目录 / 读不到的路径直接拒绝；同一项目的挂载写入串行化。
- 系统提示：新增 `project-hub/folders` section，给主对话和每个讨论串列出挂载目录
  （`foldersContextMaxChars`，默认 600）。
- 沙箱：宿主半对项目里每个存活会话调用 `ctx.sandboxPolicy.registerWritableRoot(session, dir)`；
  授权按会话、运行时有效，10 秒刷新循环在挂载变化后重新登记；`read-only` 不授予写权限。
- 面板（浏览器半）：「▤ 项目看板」里每个项目多一块文件夹区：主文件夹（`切换文件夹…` 按钮走系统选择器，
  选择器不可用时手填路径；成功后显示「已切换 + 重启后新会话才用新目录、当前对话仍在原目录」的说明）、
  辅助文件夹列表 + 添加 / 移除；宿主没有 `sandboxPolicy` 服务时明确标注「核心文件工具仍只允许主文件夹」，
  不静默降级。该区文案中英双语（读 `locale` 服务，读不到就用浏览器语言）。新增宿主路由
  `POST /project-hub/folders`（要求 `x-project-hub: 1` 请求头，挡掉跨站请求），`action` 支持
  `add` / `remove` / `main`。
- 新增 `src/mainfolder.js`（**切换主文件夹**，移植 dsh-threads PR #61 的服务端语义）：
  - 同时改两处记录，缺一不写：`~/.dsh/storages/dsh_threads.json` 的 `tables.projects[<id>].folder`
    （dsh-threads 渲染与面板显示）与 `~/.dsh/storages/workspace.json` 的 `tables.workspaces[<ws>].path`
    （**新会话的目录来源**）。只改前者会是「面板显示新目录、新会话还在旧目录」的假切换。
  - 写入优先走 `ctx.storageDomain` 里 dsh-threads / DSH 已经打开的 domain（内存态权威、写链串行，
    避免外部直写被下一次写覆盖）；宿主没暴露该服务时退化为「重新读取 → 原子 rename」，并在面板标注。
  - 写前把两个存储文件各备份成 `<文件>.bak-mainfolder-<时间戳>`；写后读回校验，不一致或抛错就回滚两处记录，
    错误带到面板（或 `/hub folder`），不静默。
  - 校验：存在 + 是目录 + `realpath` 归一化（去尾斜杠、解 symlink）；拒绝 `/`、`/Applications`、`/System`、
    `/Library`、`/usr` 等系统目录、用户主目录本身、`~/.dsh`（含子目录）、`~/.ssh` 与本插件数据目录；
    目录已被另一个 DSH workspace 占用时拒绝。写入按存储路径串行化（同一目录连点两次不会交错）。
  - **生效边界**：只写记录、不改活动会话的工作目录，所以

    > 新会话和新讨论串要等 DSH 重启之后才用新文件夹；当前这个对话在重启前仍留在原目录。

    面板（中英文案）与 `/hub folder` 都按这个语义写，不说「立即生效」。
- **行为变化**：`kb_add` 的 `path` 现在只接受主文件夹与已挂载目录里的文件，其它路径报错并列出可用挂载
  （它用插件自己的权限读盘，边界必须由插件自己兜）。
- `/hub` 命令新增 `folders`、`folders add <路径>`、`folders rm <路径>`，以及 `folder` / `folder <路径>`
  （看 / 切换主文件夹，走与面板同一个 writer，便于在 tui / headless 里调试）；
  `/hub doctor` 显示挂载数、沙箱授权状态与文件夹注入字符数。
- 配置：`maxExtraFolders`（默认 8）、`foldersContextMaxChars`（默认 600）、
  `workspaceStorage`（默认与 `threadsStorage` 同目录的 `workspace.json`，只在切换主文件夹时写）。
- 宿主半 `inject` 增加 `storageDomain`：切换主文件夹必须通过 dsh-threads / DSH 已打开的 domain 写链，
  否则下一次它们自己的写会把改动覆盖掉（丢更新）。
- 文档：README 中英各补「辅助文件夹（多目录挂载）」一节、配置表、数据目录与已知限制；
  新增 `docs/folders-feasibility.md`（沙箱 API / 主文件夹切换 / `settings.section` / 右栏页签的只读验证证据）。
- 测试：`test/harness.mjs` 30 项（新增 extraFolders 持久化、提示注入 + 沙箱授权、`/hub folders`、
  文件夹路由鉴权与增删；主文件夹切换正常改 / 目录不存在被拒 / 非法路径被拒（`/Applications`、`/`、`~/.dsh`、
  相对路径）/ 未知字段保留 / 并发写后不丢数据 / 已被占用的目录被拒 / storage-domain 写链 / `/hub folder` /
  路由返回 `restartRequired`），`test/spec-check.mjs` 10 个工具 schema 全绿。

## 0.2.1 — 2026-11-18

代码行为与 0.2.0 一致（`src/` 未改）；这一版只为把仓库里的文档同步到 npm 页面，并给发布加一道门禁。

- 文档：README 补「快速开始（3 步）」「配置项表（字段 / 默认值 / 影响）」「License」三节，中英各一份；
  修两处 heading 前缺空行、英文看板段多出来的一行 `right:`。
- `package.json` 加 `prepublishOnly` 门禁：`node test/harness.mjs && node test/spec-check.mjs`，
  以后 `npm publish` 前必过测试与 schema 校验。
- `INSTALL-LOCAL.md` removed from the public repo: the local install notes (machine-specific absolute paths and backup-directory names) now live in a private folder outside this repository. The file was never shipped in the npm package.
- GitHub 仓库主页 homepage 指向 npm 包页：<https://www.npmjs.com/package/dsh-claude-project-ui>

## 0.2.0 — 2026-11-17（npm 首发）

- 改名：`dsh-project-hub` → `dsh-claude-project-ui`（仓库、npm 包名、插件 id 一并改；仓库改名后旧地址仍重定向）。
- 新增**看板面板**（浏览器半）：侧栏页脚多一个「▤ 看板」按钮，点开是右侧浮层面板，
  按项目列出进行中的讨论串和全部任务，支持手动刷新。数据来自宿主半新注册的
  `POST /project-hub/board`（只读 JSON）。
- 客户端半按 DSH 的 `window.__ModuleLoader__` 约定手写，不依赖构建步骤；
  `package.json` 增加 `exports["./client"]` 与 `dsh.client`。
- 面板在没有 `webServer` 的 profile（tui / headless）里自动退化：宿主不注册路由，
  客户端不加载，`/hub board` 与 `board_list` 照常可用。


## 0.1.3

- 修复：进展摘要读的是 `report.files`，而 dsh-threads 实际写 `lastReport.changedFiles`——
  「文件: …」一段以前永远不会出现。现在会显示。
- 看板新增隐藏规则：默认不显示**已解决 / 已归档**的讨论串（`hideResolvedThreads`，默认 `true`）；
  `board_list all=true` 或 `/hub board --all` 可看全部，底部会提示隐藏了几个。
- 看板新增**自动汇总**：讨论串回报会幂等地汇总成看板任务（`autoConvergeReports`，默认 `true`），
  以 `threadId` 为键，重复刷新不会重复建任务，手工任务不受影响。
- 新增命令：`/hub task <标题>`、`/hub done <b-N>`、`/hub rm <b-N>`、`/hub doctor`（自检数据目录、
  讨论串存储、知识库容量和每轮注入字符数）。
- 并发安全：同一项目的看板写入串行化（`load → modify → write` 不再互相覆盖）。
- 测试：测试框架的 `check()` 之前不 await，异步断言其实是假 PASS；改成串行 await 后修好受影响的用例。
  用例从 12 项增加到 19 项，覆盖 changedFiles、隐藏规则、汇总幂等、删除任务和 `/hub doctor`。
- 文档：修正安装说明——`dsh plugin --profile desktop add` 会被无条件拒绝，桌面端只能走 App 内插件市场
  或手工装进 `node_modules` + 补 `dsh.profile.bundles`。
## 0.1.2

- 注入瘦身：知识库索引从「全量文档」改为「最多 `kbIndexMaxDocs`（默认 3）条 + 一条溢出提示」，字符上限 900 → 280；
  标题从「项目知识库」改为「项目短约定」，长文档明确交给 `dsh-knowledge` 的 `knowledge_search`。
  多文档场景下每轮约省 600 字符的重复提示词。
- 新增测试：8 篇文档时索引 ≤ 300 字符、≤ 6 行，并出现「另有 N 条」。

## 0.1.1

- 防御性改进：`agent/created` 时**同步**预热提示词缓存，不再依赖随后的异步刷新。
  早先的判断「讨论串首步缺看板」已被日志证伪——知识库走 `systemPrompt.section`（写入持久化的 system message），
  看板/进展走 `systemPrompt.context`（随 user turn 注入，记录在 `user/message` 里），
  按 system message 判断会误以为丢了。预热仍然有价值：即便刷新慢一拍，首步也有内容。
- 新增测试：`agent/created` 之后无需等待即可读到看板与进展文本。

## 0.1.0

- 项目知识库：`kb_add` / `kb_list` / `kb_search` / `kb_get` / `kb_remove`，索引自动注入项目会话。
- 跨讨论串看板：自动读取 dsh-threads 的讨论串状态，叠加 `board_add` / `board_update` / `board_list` 手动任务。
- 上下文接续：`context_brief` 生成可粘贴的项目简报；讨论串自动收到看板与最近进展。
- `/hub` 命令（status / board / kb / brief / note / add）。
- 只读 dsh-threads 存储，不修改、不 import 它的模块；卸载任一方互不影响。
