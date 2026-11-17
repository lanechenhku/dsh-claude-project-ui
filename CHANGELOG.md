# Changelog

## 0.2.0

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
