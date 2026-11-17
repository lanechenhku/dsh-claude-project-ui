# 本机安装记录（2026-11-18）

## 方式

DSH 桌面版正在运行时，`dsh plugin --profile desktop add` 会被拒绝
（`profile "desktop" is managed exclusively by the Electron application`），
所以这次用「开发链接」安装，等价于 pnpm 的 `link:` 依赖：

1. `~/.dsh/profiles/desktop/node_modules/dsh-claude-project-ui` → 指到本目录的符号链接
2. `~/.dsh/profiles/desktop/package.json`
   - `dependencies["dsh-claude-project-ui"] = "link:/Users/lanechen/Documents/deepseek-harness/default-workspace/dsh-claude-project-ui"`
   - `dsh.profile.bundles` 末尾追加 `dsh-claude-project-ui`
3. 插件靠自己的 `cordis.patch.yml` 插入 loader 行（`id: dsh-claude-project-ui`）

因为符号链接指向源码，**改 src 后只需重启 DSH 就生效**，不用重新安装、不用构建。

## 生效条件

完全退出 DSH（⌘Q）再启动。运行中的实例不会热加载新 bundle。

## 验证

启动后在「2HAI 六端开发」项目的主对话里：

```
/hub status      → 项目：2HAI 六端开发（project-…）· 讨论串：N 个 · 知识库：0 篇 · 手动任务：0 条
/hub add 发布清单
/hub kb          → [k-1] 发布清单
/hub board       → 讨论串状态 + 手动任务
/hub brief       → 可粘进 thread_open.task 的项目简报
```

然后开一个讨论串，在讨论串里问「你看到的项目看板是什么」——它应该能说出主对话刚加的内容，
说明自动注入生效（讨论串会话在创建时同步注册，第一步就能看到）。

## 回滚

```sh
rm ~/.dsh/profiles/desktop/node_modules/dsh-claude-project-ui
# 从备份恢复 manifest（安装前的版本）
cp ~/.dsh/backup-project-hub-20261118-010512/package.json ~/.dsh/profiles/desktop/package.json
```

## 以后改用正式安装

完全退出 DSH 后，把开发链接换成 pnpm 管理的版本（本地 tgz 或发布后的 npm 包）：

```sh
rm ~/.dsh/profiles/desktop/node_modules/dsh-claude-project-ui
# 先按上面「回滚」恢复 manifest，再：
dsh plugin --profile desktop add ./dsh-claude-project-ui/dist/dsh-claude-project-ui-0.1.0.tgz
```

装完确认 `dsh.profile.bundles` 仍有 `dsh-claude-project-ui`（`dsh plugin add` 不负责 bundles 列表）。
