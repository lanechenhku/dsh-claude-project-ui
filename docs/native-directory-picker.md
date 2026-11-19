# 原生文件夹选择器：插件能不能调？（结论：能）

问题来自用户：「为什么辅助文件夹只能手填路径，不能像 DSH 自己的『工作区 → 选择文件夹』那样弹原生选择器？」

结论是 **A：可以调，且返回的是字符串绝对路径**。本插件早就用这条路给「主文件夹 → 更换…」弹过框；
0.4.1 之前只是**辅助文件夹那一行没接**。本文记录证据，避免下次再翻 app.asar。

复核方法：`npx --yes @electron/asar extract "/Applications/DeepSeek Harness.app/Contents/Resources/app.asar" /tmp/dsh-asar`，
下面行号对应 **2026-11-13 打包的 app.asar**（`Resources/app.asar`，未解包目录下路径为 `lib/*` 与 `dsh/node_modules/*`）。

## 1. 调用链一：Desktop 主进程的 Electron dialog（插件最容易用的那条）

主进程注册 IPC（每个窗口一个，同一窗口同时只开一个框）：

```js
// lib/main.js:1478   const SCHEME = "dsh-app";
// lib/main.js:1458   directoryPick: "dsh-desktop:directory-pick",
// lib/main.js:12629
ipcMain.handle(DESKTOP_IPC.directoryPick, async (event) => {
  const window = getWindow();
  if (window === void 0 || window.isDestroyed() || event.sender !== window.webContents
      || event.senderFrame !== window.webContents.mainFrame)
    throw new Error("dsh desktop: rejected directory picker from an unowned renderer");   // :12631
  assertDesktopSender(event, ["app"]);                                                    // :12632
  const existing = pending.get(window);
  if (existing !== void 0) return existing;                                               // 同窗口复用同一个框
  ...
  const result = dialog.showOpenDialog(window, { properties: ["openDirectory", "createDirectory"] })
    .then(({ canceled, filePaths }) => window.isDestroyed() || canceled ? null : filePaths[0] ?? null);  // :12638
```

preload 用 contextBridge 暴露成**主世界全局对象**（只在应用文档里）：

```js
// lib/preload-app.cjs:2080
if (location.protocol === `dsh-app:` && location.hostname === "app") {
  ...
  // :2097
  electron.contextBridge.exposeInMainWorld("__DSH_DIRECTORY_PICKER__", {
    pick: () => electron.ipcRenderer.invoke(DESKTOP_IPC.directoryPick)
  });
```

窗口与地址：主窗口 `webPreferences: { preload, contextIsolation: true, sandbox: true }`（`lib/main.js:20243`/`:20269`），
文档地址是 `dsh-app://app/`（`:20470` `const applicationUrl = \`${SCHEME}://app/\``，导航见 `:20645`/`:20676`/`:21516`）。

**插件为什么能调**：插件客户端（`src/client.js`）与 DSH 前端在**同一个渲染帧、同一个主世界**里求值
（`window.__ModuleLoader__.load(...)` 的脚本由该页面执行），而 contextBridge 暴露的正是主世界全局。
所以 `globalThis.__DSH_DIRECTORY_PICKER__.pick()` 直接可见。

DSH 自己的原生弹框选择器就是这么读的：

```ts
// dsh/node_modules/@deepseek-ai/dsh-client-ui-directory-picker-native/src/client/index.ts:24-27
const desktop = (globalThis as ... & { __DSH_DIRECTORY_PICKER__?: NativeFlowInjected }).__DSH_DIRECTORY_PICKER__
const pick = desktop === undefined ? () => ctx.uiWorkspace.pickDirectory() : () => desktop.pick()
```

限制（决定了降级策略）：
- 只在 **Desktop 应用窗口**（`dsh-app://app` 主帧）里存在；用浏览器打开 `http://127.0.0.1:<port>` 时该全局不存在。
- 主进程会校验 `event.senderFrame === mainFrame` 且 origin 是 `dsh-app://app`，所以子帧 / WebView 里调不到。
- 返回值：**绝对路径字符串**；用户取消 → `null`；同一窗口重复调用复用同一个框。

## 2. 调用链二：Host 侧的 directoryPicker（浏览器里也能用）

```ts
// dsh/node_modules/@deepseek-ai/dsh-client-ui-workspace/src/client/navigation.ts:405
async pickDirectory(): Promise<string | null> {
  const result = await this.directoryPicker.pick()
  if (!result.ok) throw new Error(`directory picker failed: ${result.error.message}`)
  return result.value
}
// dsh/node_modules/@deepseek-ai/dsh-api-workspace-controller/src/directory-picker.ts:54
@Remote('pick') async pick(signal: AbortSignal): Promise<string | null> { ... capability.pick(signal) }
```

后端由 `dsh-host-directory-picker-*` 组合：native 后端在 macOS 上跑
`osascript -l JavaScript` 的 `NSOpenPanel`（`dsh-host-directory-picker-native/src/native-picker.ts:35-66`，
读 `urls.objectAtIndex(0).path`），取消返回空串 → `null`。所以这条也给**绝对路径字符串**。

## 3. 排除 B 与 C

- **不是 B（只在主进程内部）**：preload 通过 contextBridge 暴露，渲染侧可以直接调（证据见上）。
- **不是 C（只有句柄/相对路径）**：两条链路的返回值都是 `filePaths[0] ?? null` / `urls.objectAtIndex(0).path`，
  即绝对路径字符串；Html 的 `showDirectoryPicker`（File System Access）**不是**这条路，与本插件无关。

## 4. 插件里的实现

`src/client.js`：

- `pickFolderFrom(desktop, workspace)` —— 纯函数，先 Desktop bridge，再 Host `uiWorkspace.pickDirectory()`；
  都没有 → `"unavailable"`；用户取消 → `null`；Host 明确说「unavailable/not support」→ 也折成 `"unavailable"`；
  其余异常原样抛出（由调用方吞掉）。
- `pickerAvailableFrom(...)` / `pickerAvailable(read)` —— 按钮**渲染前**就问一次「这台机器有没有选择器」，
  没有就压根不渲染按钮（不是渲染出来再报错）。
- `useFolderActions` 新增 `browse`：拿到路径只 `setDraft(path)`（**填输入框，不写**），
  人再按「添加」，与手打路径完全同一条写入路径（`POST /project-hub/folders`）。
- 降级：Host 说没有 → 收起按钮 + 一行「这个环境没有文件夹选择器，请手填路径」；抛异常 → 静默收起按钮；
  `PICK_TIMEOUT_MS = 120000` 到点解放按钮（迟到的结果丢弃）。三种情况输入框都还能用，弹窗不白屏。
- i18n：新增 `dialog.browse`（zh「浏览…」/ en「Browse…」），「选择中…」复用已有的 `dialog.choosing`。
- 测试（`node test/harness.mjs`，52 → 54 条）：
  `folders: the browser offers the OS chooser only when one answers`（两条链路的优先级、取消、`unavailable`、
  异常传播、`pickerAvailable` 的三个分支）；
  `folders: 浏览… is one click away in both languages, and never writes on its own`（两份文案 + 源码接线断言）。

## 5. 只在真机上能确认的

- 按钮在 560px 弹窗里与「添加」并排的实际观感（样式复用 `S.button`，未截图确认）。
- 点「浏览…」真的弹出 macOS 面板、选完路径确实落在输入框里（真机未点过；本机 profile 是 dev 软链接，
  刷新页面即加载新代码）。
- 浏览器打开 `http://127.0.0.1:<port>` 时走 Host 链路的表现（那条路需要 profile 里组合
  `dsh-host-directory-picker-native`；本机桌面 profile 的组合未逐项核对）。

## 6. 建议的 CHANGELOG 一行（本线程未改 CHANGELOG，避免与 0.4.1 章节的其它改动冲突）

> 辅助文件夹输入框右侧新增「浏览…」：走 DSH 自己的原生文件夹选择器（Desktop 的 `__DSH_DIRECTORY_PICKER__`，
> 其余环境走 Host `uiWorkspace.pickDirectory()`），选中只填路径不写盘；没有选择器时按钮不渲染。
