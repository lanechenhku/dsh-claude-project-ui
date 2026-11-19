# GitHub About 候选（3 个，供 lead 选一个）

仓库：`lanechenhku/dsh-claude-project-ui`（0.4.1 已发 GitHub，npm 未发布；工作区版本号为 0.4.2）
限制：GitHub About 描述**硬上限 350 字符**。下面三条都是**纯 ASCII**，所以 `wc -c` 数出来就是字符数；
每条都用 `wc -c` 实测过（命令见文末），且覆盖关键词 `project board` / `threads` / `bilingual` / `folders`。
三条都**不含 emoji**（上限 1 个，这里没用）。

---

## 候选 A（推荐）：能力清单式，一句话说完

**227 字符**

```text
Claude-style project UI for DeepSeek Harness, built on dsh-threads: a project board for threads and tasks, extra folders mounted per project, a bilingual (zh/en) panel, and thread reports rolled into tasks, all editable in-app.
```

中文对照：给 DeepSeek Harness 的 Claude 风格项目界面（建在 dsh-threads 上）——项目看板统管讨论串与任务、
每个项目可挂多个文件夹、面板中英双语、讨论串回报自动变任务，全部在界面里改。

推荐理由：一条句子说完「是什么（Claude-style project UI for DSH）+ 比原来多什么（board / folders /
bilingual / roll-up）」，关键词密度最高，和 README 新增的对照表口径一致。

---

## 候选 B：差异式，先点出「不止项目列表」

**207 字符**

```text
DeepSeek Harness plugin that goes past a project list: one project board over threads and tasks, extra folders with per-session sandbox grants, bilingual UI, and reports rolled into tasks. Needs dsh-threads.
```

中文对照：给 DeepSeek Harness 的插件，比一份项目列表更进一步——一块看板统管讨论串与任务、辅助文件夹按会话
授权沙箱、界面中英双语、回报自动汇总成任务；依赖 dsh-threads。

适合：想让 About 直接说「这不是又一个项目列表」的时候。

---

## 候选 C：场景式，先说用起来是什么样

**200 字符**

```text
A project board for DeepSeek Harness: every project, its threads and tasks on one sidebar page, extra folders per project, a bilingual panel, and progress reports turned into tasks. Needs dsh-threads.
```

中文对照：DeepSeek Harness 的项目看板——所有项目、它们的讨论串与任务都在侧栏一页里，每个项目可挂额外文件夹，
面板中英双语，讨论串的进展自动变成任务；依赖 dsh-threads。

适合：面向还没装 dsh-threads 的人，先说清「你会得到什么」。

---

## 计数与校验

```bash
# 三条都用这个数（纯 ASCII，字节数 = 字符数）
wc -c <<'EOF'
Claude-style project UI for DeepSeek Harness, built on dsh-threads: a project board for threads and tasks, extra folders mounted per project, a bilingual (zh/en) panel, and thread reports rolled into tasks, all editable in-app.
EOF
```

实测：A = 227、B = 207、C = 200，均在 350 以内。

## 交给 lead 执行

```bash
gh repo edit lanechenhku/dsh-claude-project-ui --description "<选中的那条>"
```

建议同时确认 topics（About 旁边的标签）至少包含：
`deepseek-harness`、`dsh-plugin`、`project-board`、`threads`、`bilingual`、`folders`。

## 不要写进 About 的话

- 「完全替代 Claude Projects」——不准确，也不同产品。
- 「比 Claude 好」这类比较句——About 只描述自己做了什么。
- 任何 emoji 堆砌；上限 1 个，这里刻意用 0 个。
