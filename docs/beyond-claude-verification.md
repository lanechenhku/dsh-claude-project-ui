# 核实记录：「比 Claude Projects 多出的东西」

写 README 对照表之前的逐条核实（2026-11-19）。核实基线是工作区里当前的代码（`package.json` 写的是 0.4.2；0.4.1 只发到 GitHub，npm 未发布。版本号本次没有动）。
判断标准：这条能力在 `src/` 里有没有对应实现，行为是否和描述一致；不一致就降级措辞或删掉。

结论：**9 条全部成立**，其中 2 条要求把措辞收紧（见「需降级措辞」）。

---

## 1. 项目看板（置顶卡 / 吸顶分隔 / 活动倒序 / 紧凑卡 / 次级分隔）—— 成立

| 描述 | 出处 |
|---|---|
| 当前项目置顶卡片 + 左侧 3px 强调条 | `src/client.js:1935-1981`（`accentRail` 在 `:1939`）；样式 `src/client.js:933-943` |
| 「其他项目 · N」分隔，滚动吸顶 | `src/client.js:2024-2027`（文案）、`:2002-2010`（`SectionBar`）、`:950-963`（`position:"sticky"; top:0`） |
| 其他项目按最近活动倒序 | `src/client.js:449-469`（`sortProjects`）、`:2020`；活动时间取项目记录与所有讨论串里最新的：`src/project.js:200-207`，宿主填入 `src/index.js:178` |
| 紧凑卡：讨论串数 / 任务数 / 最近活动时间 | `src/client.js:1927-1933`（meta 三行）、`:1984-1999`（其他项目的紧凑卡） |
| 项目之间 1px 次级分隔 + 12px 间距 | `src/client.js:966-970`（`otherCard: borderTop 1px + paddingTop 12`） |
| 「当前项目」解析不出来就不置顶 | `src/index.js:194-200`（没有 sessionId / 解析不到则 `currentProjectId = null`）、`src/client.js:2024-2027`（退化成「全部项目」） |

## 2. 双语 + 手动覆盖即时生效 —— 成立

| 描述 | 出处 |
|---|---|
| 所有文案在 `MESSAGES.zh` / `MESSAGES.en` 两张表 | `src/client.js:63-262`（zh `:64-162`、en `:163-261`） |
| 两表 key 完全一致 | 实测各 **97** 个 key、无缺项；测试同口径校验 `test/client-checks.mjs:190-196`（门槛 ≥70）、无空文案 `:197-`、无未使用 key `:506-522` |
| 手动覆盖优先级：手动 > 应用 locale > 页面 lang > 英文 | `src/client.js:299-318`（`resolveLanguage`）；覆盖值只允许 `auto/zh/en`：`:292-297` |
| 切换即时重渲染，不用刷新 | `src/client.js:289-291`（外部 store 注释）、`:320-360`（`langStore`）、`:380-397`（`useStore`/`useLang`） |
| 不改配置就生效 | 语言存在本插件自己的 `settings.json`：`src/settings.js:15,18-29,76-78,106-113`；路径 `<dataDir>/settings.json`，默认 `~/.dsh/project-hub/`：`src/store.js:10,48-50` |

> 顺手更正：README 原写「各 79 个 key」（中英两处），实测 97，本次已改为 97。

## 3. ⚙ 看板设置六项 —— 成立（5 项持久化偏好 + 1 个动作）

| 面板那一行 | 出处 |
|---|---|
| 语言（跟随应用 / 中文 / English，括号显示应用语言） | `src/client.js:2357-2365`；文案 `:130-131` |
| 显示已解决 / 已归档的讨论串 | `src/client.js:2368-2374` |
| 自动把讨论串回报汇总成任务 | `src/client.js:2377-2383` |
| 「其他项目」卡片默认折叠 / 展开 | `src/client.js:2386-2398` |
| 排序（最近活动 / 名称） | `src/client.js:2400-2411` |
| 项目文件夹管理…（动作，不是开关） | `src/client.js:2414`（切到 `manage` 视图，`:2095-2173`） |

- 五项偏好的默认值与归一化：`src/settings.js:18-29,63-73`；写入串行化、原子写 `:90-113`。
- 宿主读同一份：启动读 `src/index.js:112-118`，每次用都读最新 `:117-118`；`:454-457`（回报汇总开关）、`:465`（隐藏讨论串）、`:216`（快照里带 settings 回传面板）。
- 写入口：`POST /project-hub/settings`，`src/index.js:389-427`；写后立刻 `syncAll()`（`:410-413`），面板下一次快照即生效。
- 不写 dsh-threads 的存储：`src/settings.js:12-13`、`src/store.js:41-50`。

## 4. 三个文件夹入口共用一套组件与一条写入路径 —— 成立

| 入口 | 出处 |
|---|---|
| A. 看板当前项目卡「更换…」+ 卡片内「辅助文件夹（N）」折叠区 | 按钮 `src/client.js:1956-1964`；折叠区 `:1978`（`CurrentProjectFolders`） |
| B. 设置页集中管理（逐项目一行，「修改」；明确没有批量改） | `src/client.js:2088-2173`（`SettingsSection`）；「没有批量改全部」文案 `:148`；槽位注入 `:2738-2744` |
| C. 注入 dsh-threads「项目设置 → 文件夹」的「⚙ 更多文件夹⋯」 | `src/client.js:2472-2594`：锚点 `.dsht-setting-path` + `.dsht-setting-block` `:2501-2512`；幂等（已有按钮只刷新文案）`:2520-2526`；任何异常吞掉不抛 `:2549-2554`；`MutationObserver` 监听 `body` `:2583-2587`；找不到锚点就 0 注入、静默 `:2514-2519`；文案 `:161,260` |
| 一套弹窗 | A 与 C 都进 `dialogStore`：`src/client.js:666-669`（注释「A and C share this one dialog」）、`:1961`、`:2126`、`:2617` |
| 一条写入路径 | 只有 `POST /project-hub/folders`（`add` / `remove` / `main` / `workspace`）：`src/index.js:264-381`；挂载增删都走 `src/folders.js:160-166` |

## 5. 辅助文件夹（多目录挂载）—— 成立

| 描述 | 出处 |
|---|---|
| `folders.json` 独立存储（每个项目一个命名空间），不碰 dsh-threads | `src/folders.js:16`（`FILE = "folders"`）、`:33-40`；每项目目录 `src/store.js:13-19`；文件头注释 `src/folders.js:6-15` |
| 每个会话登记为沙箱可写根 | `src/index.js:570-612`（`registerWritableRoot` 在 `:591`，按会话持 disposer，挂载变化时重算 `:573-576`；宿主没有该服务则记录 `available:false` 并如实告知 `:577-581`） |
| 提示注入（绝对路径 + 沙箱语义） | `src/prompts.js:38-45`；塞进会话上下文 `src/index.js:468` |
| `kb_add` 路径边界校验（主文件夹 + 已挂载，其余拒绝） | `src/tools.js:51-64`；判定 `src/folders.js:92-101`（`isInside`，两边都 realpath） |
| 路径一律存物理路径（realpath），否则沙箱拒收 | `src/folders.js:42-63` |
| 上限 `maxExtraFolders`、去重、拒绝把主文件夹当辅助目录 | `src/folders.js:133-149` |

## 6. 主文件夹切换 —— 成立（描述逐字对得上）

| 描述 | 出处 |
|---|---|
| 同时写 dsh-threads 项目记录 + DSH 工作区记录（`~/.dsh/storages/workspace.json`） | `src/mainfolder.js:8-32`（为什么两份都动）、`:341`（workspace）、`:344`（project）；workspace.json 路径 = `dsh_threads.json` 同目录：`:44-49` |
| 备份 | `src/mainfolder.js:243-254`（`.bak-mainfolder-<时间戳>`）、`:327-331` |
| realpath 校验 | `src/folders.js:43-63`（`realpathSync.native`），入口 `src/mainfolder.js:85-91` |
| 串行化写入 | `src/mainfolder.js:221-235`（按「两份存储路径」串行）、`:287-289` |
| 读回校验 | `src/mainfolder.js:347-354`（项目 folder 与 workspace path 都读回比对） |
| 失败回滚 | `src/mainfolder.js:355-372`（两处 `restore`，并把回滚问题拼进错误） |
| 拒绝 /Applications 与 ~/.dsh | `src/mainfolder.js:39-42`（系统根 + 受保护树）、`:61-83`（`~/.dsh`、`~/.ssh`、插件自己的数据目录都拒；`/Applications` 及其内部都拒） |
| 额外一致性检查 | 另一个 workspace 已占用该目录则拒绝 `:314-325`；找不到 workspace 记录则拒绝 `:305-313` |

## 7. 原生文件夹选择器（0.4.1，未发布 npm）—— 成立

| 描述 | 出处 |
|---|---|
| 「浏览…」按钮 | `src/client.js:1673-1676`（`dialog.browse` = 「浏览…」/「Browse…」`:107,206`） |
| Desktop 走 `window.__DSH_DIRECTORY_PICKER__.pick()` | `src/client.js:604-612`（`pickFolderFrom`）、`:630-645`（读 globalThis 上的桥，读失败当没有） |
| 其余环境走 `uiWorkspace.pickDirectory()` | 同上 `:606-613`（"unavailable" 归一化）；是否可用 `:618-627` |
| 无选择器不渲染按钮 | `src/client.js:1351`（`useState(() => pickerAvailable())`）、`:1666`（条件渲染） |
| 失败静默降级（收起按钮、手输照旧、超时释放） | `src/client.js:1453-1485`（`browse`：`PICK_TIMEOUT_MS` 超时、`unavailable` 收起、异常只 warn） |
| 证据文档 | `docs/native-directory-picker.md`（主进程 IPC / preload / 渲染端消费点） |

## 8. 讨论串回报自动汇总成任务 —— 成立

| 描述 | 出处 |
|---|---|
| 按 `threadId` 幂等：一个讨论串一条任务，内容没变就不写 | `src/board.js:150-152`、`:164-215`（`convergeThreadsInner`） |
| 状态映射 done/doing/pending/blocked | `src/board.js:154-155`（`REPORT_STATUS`） |
| 已解决 / 已归档的讨论串不再生成新任务（已有的收尾为 done） | `src/board.js:171-181` |
| 手动任务（没有 threadId）不动 | `src/board.js:160-162`（注释）+ 只按 `threadId` 找（`:170`） |
| 开关（默认开）与宿主调用 | `src/settings.js:24`、`src/index.js:454-457` |

## 9. 项目短约定 + 上下文简报 + 项目知识库 —— 成立

| 描述 | 出处 |
|---|---|
| 项目短约定（KB 索引）注入主对话与所有讨论串 | `src/prompts.js:13-16`（两种角色两套开头语）、`src/index.js:459-470` |
| `context_brief` 一键拼简报 | `src/tools.js:240-242` |
| KB 五件套 `kb_add / kb_list / kb_search / kb_get / kb_remove` | `src/kb.js`、`src/tools.js`（工具定义与实现）；上限 `kb.js` |
| 看板/进展也注入 | `src/prompts.js:18-31`、`src/index.js:467-470` |

---

## 需降级措辞的两条

1. **「Claude Projects 没有」这类对比句，只能用来描述它的产品模型，不能描述它的实现细节。**
   本仓库只能读到我们自己的代码，读不到 Claude 的实现。所以对照表里 Claude 那一列只写
   「一个项目一个目录」「只有项目列表」「没有看板设置」这种模型层事实，不写「Claude 做不到 X」。

2. **原生选择器不能写成「Claude 没有」。** Claude Code 本身建项目 / 换目录也会用系统选择框；
   真正的差别是**我们有两处都能挑**（切主文件夹 + 每次加辅助文件夹），并且**拿不到选择器就
   不渲染按钮、静默退回手输**。README 按这个措辞写。

## 未写进 README 的条目（拿不准或不属于对比）

- 「完全替代 Claude Projects」——不写，两个是不同产品。
- 「项目短约定 / 知识库」——Claude Code 有 CLAUDE.md 这类项目级指令文件，说成「Claude 没有」不准确；
  它属于本插件的功能（README「功能」一节已写），不放进对比表。
- 并发上限、offerApproval 两个开关——是 dsh-threads 的配置，不是本插件能力。
