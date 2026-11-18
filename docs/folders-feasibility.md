# 文件夹功能可行性验证（2026-11-18）

> 2026-11-18 更新：第 2 项「切换主文件夹」**已由本包实现**（用户决定不等上游合并，把 PR #61 的服务端语义
> 移植进 `src/mainfolder.js`）。§2 从「不可做」改写为「怎么做的、字段来源、耦合风险」；
> §1（沙箱额外根）、§3（UI 槽位）的只读验证结论不变。

> 只读验证：不写 `~/.dsh` 安装副本、不改 dsh-threads 数据、不重启 app。
> 被验证对象：`DeepSeek Harness 0.2.2`（`/Applications/DeepSeek Harness.app/Contents/Resources/app.asar`，
> 包源码从 asar 抽出到 `/tmp/dsx`，行号即该包 `src/*.ts` 原文行号）、
> `@kyf-eng/dsh-threads` 0.2.0（本机 install 为打过 PR #61 补丁的 dist；PR 源码在
> `~/Documents/deepseek-harness/pr-work/dsh-threads`）。

## 结论表

| # | 能力 | 结论 | 依赖 / 绕路 |
|---|---|---|---|
| 1 | 给沙箱加「额外允许路径」的插件 API | **可做** | `ctx.sandboxPolicy.registerWritableRoot(session, dir)`；按会话、运行时生效、返回 disposer |
| 2 | 切换项目**主文件夹** | **已在本包实现（写入 dsh-threads 记录）** | `src/mainfolder.js`：同时写 `dsh_threads.json` 的 `projects[].folder` 与 `workspace.json` 的 `workspaces[].path`；详见 §2 |
| 3 | 我们的插件承载文件夹 UI | **可做** | 现有 `sidebar.right.pane.tab`（keyed/session）里加一块即可；`settings.section` 也可用（形状见 §3） |
| 4 | 辅助文件夹（多目录挂载）整体 | **可做** | 存本插件 `projects/<id>/folders.json`；提示注入 + 沙箱授权 + 我们自己的 `kb_add` 路径校验 |

---

## 1) 沙箱额外允许路径 API

**结论：有，且第三方插件可直接复用。** DSH 把它做成 Cordis 服务 `ctx.sandboxPolicy` 的公开方法
（不是 dsh-threads 私有的）。

证据：

- `dsh/node_modules/@deepseek-ai/dsh-sandbox-policy/src/index.ts:244-261` —— 方法签名与语义：

  ```ts
  registerWritableRoot(session: Session, directory: string): () => void
  ```

  注释写明：给「这个会话」后续的 workspace-write 操作加写授权；调用方拥有该 effect，dispose 只撤销自己这一条；
  授权是**运行时**的，resume / fork 后要重新注册；Windows 上只有 harness 的文件工具认，进程隔离不认。
- `dsh-sandbox-policy/src/index.ts:208-220` —— `resolve()` 把「配置里的额外根 + 该会话的活动注册」快照进
  `additionalWritableRoots`，文件工具与沙箱执行器读同一份策略。
- `dsh-sandbox/src/index.ts:48-69` —— `SandboxExecutionPolicy.additionalWritableRoots` 的契约
  （「Extra physical absolute directories workspace-write may also write under」）。
- `dsh-sandbox/src/roots.ts:87-91`、`:103-105` —— `workspaceWritableRoots()` / `writableRoots()` 把
  workspaceRoot 与额外根合并成允许列表（`read-only` 返回空）。
- `dsh-fs-sandbox/src/index.ts:160-176` —— 文件写入的 containment 检查用 `writableRoots(policy)`，即额外根真的生效。
- `dsh/node_modules/@deepseek-ai/dsh/docs/subsystems/sandbox.md:221-233` —— 文档里作为 surface 公开列出
  `registerWritableRoot`，说明它是受支持的扩展点而不只是内部实现。
- **上游 PR #61 正是这么做的**：`pr-work/dsh-threads/src/install.ts:21-25` 定义 `SandboxPolicyLike`，
  `:56-62` 对每个挂载目录 `policy.registerWritableRoot(agent.session, folder)`，并在
  `:40-42` 把挂载列表拼进 key、变化时重装——证明「第三方插件 / 另一个 profile bundle」能拿到这个服务。

注意事项（实现时按此处理）：

- 授权按 **Session 对象**，不是按目录全局；我们得对项目里每个存活会话各注册一次（主对话 + 每个讨论串）。
- 运行时授权，**重启 / resume / fork 后消失**；要跟着插件的刷新循环重新注册。
- `read-only` 模式下额外根不授予任何写权限；`danger-full-access` 本来就不受限。
- 路径必须是**物理绝对路径**：`dsh-sandbox/src/roots.ts:36-50` 对 symlink 拼写直接报
  `SANDBOX_INVALID_ROOT`；不存在、不是目录也会在每次调用时被拒绝。→ 我们存盘前 `realpath` 归一化。
- 句柄来源：`ctx.get('sandboxPolicy')`（try/catch 兜底，缺失时 `undefined`，不能静默当成功）。

## 2) 切换项目主文件夹

**结论：已在本包实现（2026-11-18，用户决定不等上游合并）。** 上游 PR #61 已在 dsh-threads 内部做了这件事；
本包把它的服务端语义移植过来，不改它的 UI 结构。下面写清「谁读哪个字段」「为什么不能直写文件」
「本包怎么兜住安全」「和 PR #61 的差异」「耦合风险」。

### 2.1 两个记录，各喂一个消费者（字段来源）

| 记录 | 文件 | 字段 | 谁读它 |
|---|---|---|---|
| dsh-threads 项目 | `~/.dsh/storages/dsh_threads.json` | `tables.projects[<projectId>].folder` | dsh-threads 渲染项目栏、`projects.update` 的校验；本插件面板直接读它（不另存一份真相） |
| DSH workspace | `~/.dsh/storages/workspace.json` | `tables.workspaces[<workspaceId>].path` | DSH workspace registry；**新建会话的目录**（`sessionController.create({ workspaceId })`） |

证据（PR #61 分支源码，`~/Documents/deepseek-harness/pr-work/dsh-threads`）：

- `src/storage.ts` 的 `projectSchema` 有 `folder` 与 `workspaceId`；`src/types.ts:126-140` 注释：
  「A project … one folder (a DSH workspace)」。
- `src/host.ts:190-201` `switchFolder`：**先**改 `ctx.storageDomain.get('workspace').table('workspaces')`
  的 `path`，再让 `projects.update` 落 `folder`——两处一起改。
- `src/host.ts:110-116` `createSession`、`:129-131` `createMainSession` 都以 `workspaceId` 建会话，
  即新会话目录来自 `workspace.json` 的 `path`；`src/host.ts:137-138` `workspace(workspaceId)` 读的是 registry。
- **对任务书的一处修正**：任务书写「`project.folder` 是它创建会话时读取的来源」，实测**不是**——
  只写 `project.folder` 会让面板显示新目录、新讨论串仍在旧目录（假切换）。所以本包两处一起写，
  第二处写不进去时整次切换失败、什么都不改。
- `src/projects.ts:180` `folderPendingRestart: workspace.path !== project.folder`：dsh-threads 自己的 UI 用
  registry **内存里**的 workspace 路径与项目记录比较，因此它本来就会显示「需要重启」——与本包的文案一致。

### 2.2 为什么不能「直接从外面改文件」

- `dsh-storage-domain/src/domain.ts:1-10`：domain 的**内存态是权威**，读是同步读内存，写走**单条写链**
  （先落盘、再改内存、再发事件）。
- `dsh-storage-json/src/single-unit.ts`：single 布局每次写都**整文件原子重发**。
- 所以外部改文件 → 运行中的 dsh-threads / DSH 看不到（读内存），它们下一次写会把外部改动整段覆盖（丢更新）；
  同一 domain 只允许一个打开句柄（`storage-domain/src/index.ts` `open` 的 `already-open`）。
- 本包因此**优先走 `ctx.storageDomain`**：`get('dsh_threads')` / `get('workspace')` 拿到的就是它们已打开的那个
  domain，`table.update()` 排在同一条写链上（`domain.d.ts`：`update` 的 `fn` 看到「队列槽位上的当前值」）。
  宿主没有暴露该服务时（非标准 profile、测试）才退化为文件直写：**重新读取 → 原子 rename**，
  并在面板上写明「这次是直写文件，重启前可能被覆盖」，不假装等价。

### 2.3 本包的做法（`src/mainfolder.js`）

1. **校验**：必须绝对路径（`~` 可展开）、存在、是目录；`realpath` 归一化（去尾斜杠、解 symlink）；
   拒绝 `/`、`/Applications`、`/System`、`/Library`、`/usr`、`/bin`、`/sbin`、`/etc`、`/dev`、`/cores`
   这些系统根，拒绝系统目录里的**任何**路径、用户主目录本身、`~/.dsh`（含子目录）、`~/.ssh`、
   本插件自己的数据目录（`protectedTrees`）。
2. **冲突检查**：目标目录已被**另一个** DSH workspace 记录占用时拒绝（否则 DSH 启动时的 workspace 一致性检查会失败）。
3. **备份**：`dsh_threads.json` 与 `workspace.json` 各留一份 `<文件>.bak-mainfolder-<时间戳>`。
4. **写**：先写 workspace 的 `path`，再写 project 的 `folder` + `updatedAt`（整条记录替换，未知字段不动）。
5. **读回校验 + 回滚**：读回两条记录，任何一条不等于目标就回滚两条（`restore` 只改回那一个字段，
   不回写整份快照），错误信息带备份路径；面板 / `/hub folder` 直接显示该错误。
6. **串行化**：模块内按「两个存储路径」做读写队列，连点两次不会交错；走 domain 时另外还有 domain 自己的写链。
7. **生效边界**：只写这两条记录，**不调用**任何改活动会话工作目录的 API（PR #61 的 `enterFolder` 属于
   dsh-threads 的私有 host 能力）。因此：

   > **新会话和新讨论串要等 DSH 重启之后才用新文件夹；当前这个对话在重启前仍留在原目录。**

   面板（中英）与 `/hub folder` 的文案都按这句写，不出现「立即生效」。

### 2.4 与上游 PR #61 的差异

| | PR #61（dsh-threads 内） | 本包（`src/mainfolder.js`） |
|---|---|---|
| 改写 `workspace.path` | ✅ `switchFolder` | ✅ 同一语义 |
| 改写 `project.folder` | ✅ `projects.update` | ✅ 同一语义 |
| 当前主对话当场换目录 | ✅ `enterFolder` → `workingDirectory.set` | ❌ **故意不做**（用户要求「当前对话不动」，且那是它的私有 host API） |
| 备份 / 回滚 | ❌（domain 写链保证原子，但没有备份） | ✅ 写前备份、写后读回、失败回滚 |
| 危险路径校验 | ❌ 只校验「存在且是目录」+ 路径占用 | ✅ 额外拒绝系统目录 / 家目录 / `~/.dsh` / `~/.ssh` / 插件数据目录 |
| UI | 它自己的项目设置页 | 本包「▤ 项目看板」的文件夹区 + `/hub folder` |

### 2.5 耦合风险（必须知道）

- domain 名（`dsh_threads` / `workspace`）与字段（`projects[].folder` / `workspaces[].path`）是**私有契约**，
  上游改 schema 时本包会失败：`table.update` 抛错或读回不一致 → 回滚 + 报错，不会写坏记录。
- 文件直写退化路径（宿主没有 `storageDomain`）本质上仍有丢更新窗口：面板会标注，重启前建议再看一眼路径。
- PR #61 合并后应改用它提供的官方入口（它还会处理 `extraFolders`、主对话 cwd），
  本包的 writer 可以在那时缩成一个调用。
- 本包 `inject` 因此多了 `storageDomain`：没有这个服务的 profile 会让插件等待挂载（与 `webServer` 同样的取舍）。

### 2.6 早期被否掉的绕路（历史记录，2026-11-18 上午的结论）

实现前逐条否掉的绕法，留档避免重复踩；括号里是本次实现怎么处理它们：

1. **直接写 `dsh_threads.json`** → 丢更新（domain 内存态权威、整文件重发）。→ 现在只在宿主没有
   `storageDomain` 时退化使用，并明确标注「直写文件」；正常路径走 domain 写链。
2. **只用 `ctx.storageDomain.get('dsh_threads')` 改 `projects[].folder`** → 写序安全了，但不换
   DSH workspace、新会话仍旧目录，UI 是假的「已切换」。→ 现在**同时**改 `workspace.json` 的
   `workspaces[].path`，第二处写不进去就整体失败。
3. **浏览器半直接 `POST /api/dsh-threads` 的 `projects.update`** → 只在打了 PR #61 补丁的本机 install 上有效，
   私有契约、未合并。→ 仍然不做。

## 3) 我们的插件承载 UI

### 3.1 右栏页签（本插件当前做法，推荐）

- slot 名：`sidebar.right.pane.tab`，契约：`dsh-client-ui-sidebar-right/src/client/contract/slots.ts:59-64`
  （keyed、session 作用域、owner 声明里带 `hookContext` 与 `inject: { hooks: { tabInfo } }`）。
- 本插件已经在用：`src/client.js:227-232`
  `slots.inject("sidebar.right.pane.tab", () => slots.register({ name, key: TAB_ID, inject: () => ({}) }, BoardTab))`。
- 结论：文件夹 UI 直接加进现有「▤ 项目看板」页签的 `ProjectBlock` 里即可，不需要新 slot；
  数据走宿主半已有 webServer 路由模式（`src/index.js:132-159`）。

### 3.2 `settings.section`（备选：做成设置页）

注册形状（list、root 作用域），选项：`id`（必填，list 键 / 导航过滤）、`order`、`label`
（字符串或 `() => 本地化文案`）、可选 `locale`、`inject`、`children`；组件 props 是
`PropsRuntime<'settings.section'>`，owner 侧只给一个 `{ close: () => void }`。

证据：`dsh-client-ui-settings/src/client/contract/slots.ts:46-57`（类型）、`:134-137`（owner props），
`dsh-client-ui-settings-general/src/client/index.ts:266-272`（真实注册）、
`dsh/docs/subsystems/slots.md:27-52`（`inject` + `register` 范式）。

最小示例（浏览器半，未在本插件启用）：

```js
const slots = ctx.get("slots");
const Section = ({ close }) =>
  React.createElement("div", null,
    React.createElement("h3", null, "项目文件夹"),
    React.createElement("p", null, "辅助文件夹在这里管理。"),
    React.createElement("button", { onClick: close }, "关闭"));

slots.inject("settings.section", () =>
  slots.register({
    name: "settings.section",
    id: "project-folders",   // list 槽必填，也是 settings.section.icon 的匹配键
    order: 60,
    label: () => "项目文件夹",
    inject: () => ({})
  }, Section));
```

注意：`settings.section` 由 ui-settings-general 在运行时声明；第三方只能 `inject` 后注册
（`slots.md:27`），不能自己声明这个槽。设置面板不属于本项目当前交互（用户在右栏做），
所以本次实现放在右栏页签，设置页留作以后。

## 4) 实现边界（由上面三条推出）

- 辅助文件夹：**做**。存本插件自己的 `projects/<id>/folders.json`（与 dsh_threads 不双写）；
  系统提示用 `systemPrompt.section` 列出挂载；对我们自己的 `kb_add` 读文件路径做
  「主文件夹或已挂载目录」校验；沙箱侧用 `registerWritableRoot` 对项目每个会话授权，
  授不到（服务缺失 / 目录消失）时在面板上明说，不静默降级。
- 主文件夹切换：**实现**（`src/mainfolder.js`）。两处记录一起改、写前备份、走 storage-domain 写链、
  写后读回校验、失败回滚；面板按钮可用并写明「重启后新会话才用新目录、当前对话不动」；
  `/hub folder [<路径>]` 等价入口。风险与差异见 §2.3–§2.5。