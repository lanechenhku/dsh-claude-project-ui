// Browser-half checks: i18n fallback, board ordering, the dialog container, and
// the DOM injection that puts a button inside dsh-threads' own folder card.
import { readFileSync } from "node:fs";
//
// The browser half is one self-contained bundle (the client module loader
// evaluates it as a script), so it is imported here the way the loader does it:
// a stubbed window captures the factory, which is then called with a stubbed
// require. Its __test surface is the plugin's only test seam.

/** A minimal element that supports exactly what the injector touches. */
function makeElement(tag, options) {
  const settings = options || {};
  const element = {
    tag,
    className: settings.className || "",
    textContent: settings.text || "",
    attributes: {},
    children: [],
    handlers: {},
    parent: null,
    style: { cssText: "" },
    type: "",
    setAttribute(name, value) {
      element.attributes[name] = String(value);
    },
    getAttribute(name) {
      return Object.hasOwn(element.attributes, name) ? element.attributes[name] : null;
    },
    appendChild(child) {
      child.parent = element;
      element.children.push(child);
      return child;
    },
    addEventListener(type, handler) {
      if (!Array.isArray(element.handlers[type])) element.handlers[type] = [];
      element.handlers[type].push(handler);
    },
    click() {
      for (const handler of element.handlers.click || []) handler({});
    },
    matches(selector) {
      if (selector.startsWith(".")) return element.className.split(/\s+/).filter(Boolean).includes(selector.slice(1));
      if (selector.startsWith("[") && selector.endsWith("]")) return Object.hasOwn(element.attributes, selector.slice(1, -1));
      return false;
    },
    closest(selector) {
      let node = element;
      while (node !== null && node !== undefined) {
        if (typeof node.matches === "function" && node.matches(selector)) return node;
        node = node.parent;
      }
      return null;
    },
    querySelector(selector) {
      for (const child of element.children) {
        if (child.matches(selector)) return child;
        const deeper = child.querySelector(selector);
        if (deeper !== null) return deeper;
      }
      return null;
    },
    querySelectorAll(selector) {
      const found = [];
      for (const child of element.children) {
        if (child.matches(selector)) found.push(child);
        found.push(...child.querySelectorAll(selector));
      }
      return found;
    }
  };
  return element;
}

/** A document holding one dsh-threads project-settings folder card. */
function makeThreadsDocument(path) {
  const body = makeElement("body", { className: "app" });
  const settings = makeElement("div", { className: "dsht-dialog dsht-settings" });
  const main = makeElement("div", { className: "dsht-settings-main" });
  const block = makeElement("div", { className: "dsht-setting-block" });
  const pathNode = makeElement("div", { className: "dsht-setting-path dsht-mono" });
  pathNode.setAttribute("title", path);
  pathNode.textContent = path;
  block.appendChild(pathNode);
  main.appendChild(block);
  settings.appendChild(main);
  body.appendChild(settings);
  const doc = {
    body,
    block,
    createElement: (tag) => makeElement(tag),
    querySelector: (selector) => body.querySelector(selector),
    querySelectorAll: (selector) => body.querySelectorAll(selector)
  };
  return doc;
}

/** A document just rich enough to prove the dialog container is created once. */
function makeFakeDocument() {
  const body = makeElement("body");
  const byId = new Map();
  const appendChild = body.appendChild;
  body.appendChild = (child) => {
    const appended = appendChild(child);
    if (typeof child.id === "string" && child.id.length > 0) byId.set(child.id, child);
    return appended;
  };
  return {
    body,
    createElement: (tag) => makeElement(tag),
    getElementById: (id) => byId.get(id) ?? null
  };
}

/** Load the browser half the way the client module loader does. */
async function loadClient(clientPath) {
  const captured = { spec: null };
  globalThis.window = { __ModuleLoader__: { load: (spec) => { captured.spec = spec; } } };
  const module = await import(clientPath);
  void module;
  if (captured.spec === null) throw new Error("the client bundle never called the module loader");
  if (captured.spec.id !== "dsh-claude-project-ui") throw new Error("unexpected module id " + captured.spec.id);
  const react = {
    createElement: () => null,
    useState: (initial) => [typeof initial === "function" ? initial() : initial, () => {}],
    useEffect: () => {},
    useCallback: (fn) => fn,
    useSyncExternalStore: (subscribe, getSnapshot) => getSnapshot(),
    Fragment: "Fragment"
  };
  return captured.spec.factory((name) => (name === "react" ? react : undefined));
}

function makeFakeContext() {
  const registered = [];
  const dictionaries = [];
  const effects = [];
  const localeEvents = [];
  const slots = {
    inject(name, factory) {
      const result = factory();
      if (result !== undefined) registered.push({ name, spec: result.spec, component: result.component });
    },
    register(spec, component) {
      return { spec, component };
    }
  };
  const locale = {
    getLocale: () => ({ active: "en", locales: ["en", "zh"], revision: 1 }),
    register(namespace, messages) {
      dictionaries.push({ namespace, messages });
      return () => {};
    },
    bind: () => (key) => key
  };
  const tabs = {
    register(spec) {
      return spec;
    }
  };
  const ctx = {
    get(name) {
      if (name === "slots") return slots;
      if (name === "locale") return locale;
      if (name === "sidebarRightTabs") return tabs;
      if (name === "sidebarRight") return { openTab: () => {} };
      return undefined;
    },
    effect(factory) {
      // Cordis runs the factory now and owns the returned disposer.
      const dispose = factory();
      effects.push(typeof dispose === "function" ? dispose : () => {});
      return () => {};
    },
    on(event) {
      localeEvents.push(event);
      return () => {};
    }
  };
  return { ctx, registered, dictionaries, effects, localeEvents, slots, locale };
}

export async function runClientChecks(check, clientPath) {
  const plugin = await loadClient(clientPath);
  const helpers = plugin.__test;
  const { MESSAGES, translate, normalizeLang, sortProjects, relativeTime, findProjectByFolder, toneOf, threadCode, taskStatus, createThreadsInjector, langStore, dialogStore, emptyBoard } = helpers;
  const { resolveLanguage, normalizeClientSettings, sameSettings, SETTINGS_DEFAULTS, settingsStore, panelStore } = helpers;

  check("i18n: both dictionaries carry every key, with no empty value", () => {
    const zh = Object.keys(MESSAGES.zh).sort();
    const en = Object.keys(MESSAGES.en).sort();
    if (zh.length < 70) throw new Error("only " + zh.length + " keys: the tables look incomplete");
    const onlyZh = zh.filter((key) => !Object.hasOwn(MESSAGES.en, key));
    const onlyEn = en.filter((key) => !Object.hasOwn(MESSAGES.zh, key));
    if (onlyZh.length > 0) throw new Error("missing from en: " + onlyZh.join(", "));
    if (onlyEn.length > 0) throw new Error("missing from zh: " + onlyEn.join(", "));
    for (const [lang, table] of Object.entries(MESSAGES)) {
      for (const [key, value] of Object.entries(table)) {
        if (typeof value !== "string" || value.trim().length === 0) throw new Error(lang + "." + key + " is empty");
      }
    }
  });

  check("i18n: follows the language, interpolates, and falls back to English", () => {
    if (translate("zh", "settings.nav") !== "项目文件夹") throw new Error("zh copy did not resolve");
    if (translate("en", "settings.nav") !== "Project folders") throw new Error("en copy did not resolve");
    if (translate("en", "board.section.others", { count: 3 }) !== "Other projects · 3") {
      throw new Error("placeholder interpolation failed: " + translate("en", "board.section.others", { count: 3 }));
    }
    // A key that only exists in English must render English, not the raw key.
    MESSAGES.en["test.englishOnly"] = "English only";
    try {
      if (translate("zh", "test.englishOnly") !== "English only") throw new Error("a zh miss did not fall back to English");
    } finally {
      delete MESSAGES.en["test.englishOnly"];
    }
    if (translate("zh", "no.such.key") !== "no.such.key") throw new Error("an unknown key must render as itself");
    if (normalizeLang("zh-CN") !== "zh" || normalizeLang("en-US") !== "en" || normalizeLang("") !== "en") {
      throw new Error("language tags did not normalise");
    }
  });

  check("board: the current project is promoted, the rest sort by activity", () => {
    const projects = [
      { id: "a", title: "Alpha", activity: "2026-11-18T10:00:00.000Z" },
      { id: "b", title: "Beta", activity: "2026-11-18T12:00:00.000Z" },
      { id: "c", title: "Gamma", activity: "2026-11-18T09:00:00.000Z" },
      // Same instant as beta: the title breaks the tie so the order is stable.
      { id: "d", title: "Delta", activity: "2026-11-18T12:00:00.000Z" }
    ];
    const snapshot = JSON.stringify(projects);
    const withCurrent = sortProjects(projects, "c");
    if (withCurrent.current === null || withCurrent.current.id !== "c") throw new Error("the current project was not promoted");
    if (withCurrent.others.map((entry) => entry.id).join(",") !== "b,d,a") {
      throw new Error("wrong order: " + withCurrent.others.map((entry) => entry.id).join(","));
    }
    const withoutCurrent = sortProjects(projects, null);
    if (withoutCurrent.current !== null) throw new Error("no current project should be promoted");
    if (withoutCurrent.others.length !== 4) throw new Error("every project must still be listed");
    const unknownCurrent = sortProjects(projects, "not-a-project");
    if (unknownCurrent.current !== null) throw new Error("an unknown current id must promote nothing");
    if (unknownCurrent.others.length !== 4) throw new Error("an unknown current id must not drop a project");
    if (JSON.stringify(projects) !== snapshot) throw new Error("sortProjects mutated its input");
    const missingActivity = sortProjects([{ id: "x", title: "X" }, { id: "y", title: "Y", activity: "2026-11-18T00:00:00.000Z" }], null);
    if (missingActivity.others[0].id !== "y") throw new Error("a project without activity must sort last");
    // "title" is A→Z, and the current project still leads.
    const byTitle = sortProjects(projects, "a", "title");
    if (byTitle.current === null || byTitle.current.id !== "a") throw new Error("the current project must lead in title order too");
    if (byTitle.others.map((entry) => entry.title).join(",") !== "Beta,Delta,Gamma") {
      throw new Error("title order is wrong: " + byTitle.others.map((entry) => entry.title).join(","));
    }
    const titleOnly = sortProjects(projects, null, "title");
    if (titleOnly.others.map((entry) => entry.title).join(",") !== "Alpha,Beta,Delta,Gamma") {
      throw new Error("title order without a current project is wrong: " + titleOnly.others.map((entry) => entry.title).join(","));
    }
    // An unknown mode behaves like the default rather than throwing.
    const fallbackMode = sortProjects(projects, null, "nonsense");
    if (fallbackMode.others[0].id !== "b") throw new Error("an unknown sort mode must fall back to activity");
  });

  check("language: a manual choice beats the app language, which beats English", () => {
    // A manual choice wins over whatever the app reports.
    if (resolveLanguage({ override: "zh", appLang: "en", pageLang: "en" }) !== "zh") throw new Error("manual zh lost to the app language");
    if (resolveLanguage({ override: "en", appLang: "zh", pageLang: "zh" }) !== "en") throw new Error("manual en lost to the app language");
    // "auto" is not an opinion: the app language decides.
    if (resolveLanguage({ override: "auto", appLang: "zh", pageLang: "en" }) !== "zh") throw new Error("auto did not follow the app language");
    if (resolveLanguage({ override: "auto", appLang: "en-US" }) !== "en") throw new Error("a region tag did not resolve");
    if (resolveLanguage({ override: "auto", appLang: "zh-CN" }) !== "zh") throw new Error("a zh region tag did not resolve");
    // Nothing usable anywhere falls back to English.
    if (resolveLanguage({ override: "auto", appLang: "", pageLang: "" }) !== "en") throw new Error("the empty case did not fall back to English");
    if (resolveLanguage({}) !== "en") throw new Error("an empty options object must render English");
    // A junk override is treated as "auto", never as a third language.
    if (resolveLanguage({ override: "fr", appLang: "zh" }) !== "zh") throw new Error("an unknown override must behave like auto");
    // The page language is only a stopgap below the app language.
    if (resolveLanguage({ override: "auto", appLang: "en", pageLang: "zh" }) !== "en") throw new Error("the page language beat the app language");
  });

  check("settings: the client normalises to the same shape, and drops junk", () => {
    const normal = normalizeClientSettings({ ...SETTINGS_DEFAULTS, language: "zh", sort: "title" });
    if (normal.language !== "zh" || normal.sort !== "title") throw new Error("a valid object was not accepted");
    if (!sameSettings(normal, normalizeClientSettings(normal))) throw new Error("sameSettings is not reflexive");
    const junk = normalizeClientSettings({ language: "fr", sort: "random", showResolvedThreads: "true", autoConvergeReports: "nope" });
    if (junk.language !== SETTINGS_DEFAULTS.language) throw new Error("an unknown language was not clamped");
    if (junk.sort !== SETTINGS_DEFAULTS.sort) throw new Error("an unknown sort was not clamped");
    if (junk.showResolvedThreads !== true) throw new Error("a string boolean was not coerced");
    if (junk.autoConvergeReports !== SETTINGS_DEFAULTS.autoConvergeReports) throw new Error("a junk boolean did not fall back");
    if (!sameSettings(normalizeClientSettings({}), SETTINGS_DEFAULTS)) throw new Error("defaults drifted from SETTINGS_DEFAULTS");
    // The stores start from those defaults, and the popover starts closed.
    if (!sameSettings(settingsStore.getSnapshot(), SETTINGS_DEFAULTS)) throw new Error("the settings store did not start at the defaults");
    if (panelStore.getSnapshot().open !== false) throw new Error("the ⚙ popover started open");
  });

  check("board: relative activity reads correctly in both languages", () => {
    const now = Date.parse("2026-11-18T12:00:00.000Z");
    if (relativeTime("2026-11-18T11:59:30.000Z", "en", now) !== "just now") throw new Error("under a minute");
    if (relativeTime("2026-11-18T11:30:00.000Z", "en", now) !== "30 min ago") throw new Error("minutes");
    if (relativeTime("2026-11-18T09:00:00.000Z", "en", now) !== "3 h ago") throw new Error("hours");
    if (relativeTime("2026-11-15T12:00:00.000Z", "en", now) !== "3 d ago") throw new Error("days");
    if (relativeTime("2026-11-18T11:30:00.000Z", "zh", now) !== "30 分钟前") throw new Error("zh minutes");
    if (relativeTime("", "en", now) !== "no activity recorded") throw new Error("missing activity");
    if (relativeTime("2026-09-01T00:00:00.000Z", "en", now) !== "2026-09-01") throw new Error("an old date must print as a date");
  });

  check("board: status codes map to the five tones and never leak a raw value", () => {
    if (toneOf("doing") !== toneOf("running")) throw new Error("doing and running must share the blue dot");
    if (toneOf("done") !== toneOf("resolved")) throw new Error("done and resolved must share the green dot");
    if (toneOf("blocked") !== toneOf("waiting")) throw new Error("blocked and waiting must share the orange dot");
    if (toneOf("pending") === toneOf("doing")) throw new Error("pending must not use the doing colour");
    if (toneOf("idle") === toneOf("pending")) throw new Error("idle must be lighter than pending");
    if (threadCode("nonsense") !== "unknown") throw new Error("an unknown thread code must clamp");
    if (taskStatus("nonsense") !== "pending") throw new Error("an unknown task status must clamp");
    const label = translate("en", "thread." + threadCode("nonsense"));
    if (label !== "Unknown") throw new Error("clamped codes must still translate: " + label);
  });

  check("folders: a project is found by its folder path, trailing slash ignored", () => {
    const projects = [{ id: "p1", folder: "/Users/me/project" }, { id: "p2", folder: "/Users/me/other/" }];
    if (findProjectByFolder(projects, "/Users/me/project/")?.id !== "p1") throw new Error("exact path with a trailing slash");
    if (findProjectByFolder(projects, "/Users/me/other")?.id !== "p2") throw new Error("stored path with a trailing slash");
    if (findProjectByFolder(projects, "/Users/me") !== null) throw new Error("a parent path must not match");
    if (findProjectByFolder(projects, "") !== null) throw new Error("an empty path must match nothing");
  });

  check("injection: one button per card, re-scans are idempotent, labels refresh", () => {
    const doc = makeThreadsDocument("/Users/me/project");
    const opened = [];
    let label = "MORE";
    const injector = createThreadsInjector({ document: doc, open: (path) => opened.push(path), label: () => label });
    const buttons = () => doc.block.querySelectorAll("[data-project-hub-more]");
    injector.start();
    if (buttons().length !== 1) throw new Error("expected exactly one button after start, got " + buttons().length);
    injector.scan();
    injector.scan();
    if (buttons().length !== 1) throw new Error("re-scanning stacked duplicate buttons");
    const button = buttons()[0];
    if (button.getAttribute("data-project-hub-more") === null) throw new Error("the button lost its marker attribute");
    if (button.textContent !== "MORE") throw new Error("the button copy was not written");
    label = "更多文件夹";
    injector.scan();
    if (buttons().length !== 1) throw new Error("a relabel added a second button");
    if (button.textContent !== "更多文件夹") throw new Error("the copy did not follow the language");
    button.click();
    if (opened.length !== 1 || opened[0] !== "/Users/me/project") throw new Error("the click did not report the folder path");
    injector.stop();
    injector.scan();
    if (buttons().length !== 1) throw new Error("a stopped injector must not touch the DOM");
  });

  check("injection: no anchor, no dialog, or a broken DOM loses the button and nothing else", () => {
    // The hostile case logs a warning by design; keep the report readable.
    const realWarn = console.warn;
    console.warn = () => {};
    const empty = { body: makeElement("body"), createElement: (tag) => makeElement(tag), querySelector: () => null, querySelectorAll: () => [] };
    const quiet = createThreadsInjector({ document: empty, open: () => {}, label: () => "MORE" });
    quiet.start();
    if (quiet.scan() !== 0) throw new Error("a document without dsh-threads settings must inject nothing");
    quiet.stop();
    // A path node with no block around it is skipped, not injected next to. 
    const loose = makeThreadsDocument("/tmp/x");
    loose.block.children[0].parent = null;
    const orphan = createThreadsInjector({ document: loose, open: () => {}, label: () => "MORE" });
    orphan.start();
    if (loose.block.children.length !== 1) throw new Error("an unanchored path must not be injected into");
    orphan.stop();
    // A document whose queries throw must not throw out of the injector.
    const hostile = {
      body: makeElement("body"),
      createElement: (tag) => makeElement(tag),
      querySelector() { throw new Error("boom"); },
      querySelectorAll() { throw new Error("boom"); }
    };
    const guarded = createThreadsInjector({ document: hostile, open: () => {}, label: () => "MORE" });
    guarded.start();
    if (guarded.scan() !== 0) throw new Error("a throwing DOM must scan to zero");
    guarded.stop();
    // No document at all (a host without a DOM): start returns a disposer.
    const headless = createThreadsInjector({ document: null });
    const dispose = headless.start();
    if (typeof dispose !== "function") throw new Error("start must return a disposer");
    dispose();
    console.warn = realWarn;
  });

  check("plugin: apply registers four surfaces and follows the locale service", () => {
    const fake = makeFakeContext();
    plugin.apply(fake.ctx);
    const byName = new Map(fake.registered.map((entry) => [entry.name, entry]));
    for (const name of ["sidebar.right.pane.tab", "sidebar.right.pane.tab.title", "conversation.session.header.actions", "settings.section", "shell.overlay"]) {
      if (!byName.has(name)) throw new Error("no registration for " + name);
    }
    const section = byName.get("settings.section").spec;
    if (section.id !== "project-folders") throw new Error("settings section id changed: " + section.id);
    if (typeof section.label !== "function") throw new Error("the settings section has no nav label");
    if (section.label() !== "Project folders") throw new Error("the nav label did not follow the active locale: " + section.label());
    const tab = byName.get("sidebar.right.pane.tab").spec;
    if (tab.key !== "project-hub") throw new Error("tab key changed: " + tab.key);
    if (fake.dictionaries.length !== 1) throw new Error("the dictionaries were not registered with the locale service");
    if (fake.dictionaries[0].namespace !== "project-hub") throw new Error("locale namespace changed: " + fake.dictionaries[0].namespace);
    if (Object.keys(fake.dictionaries[0].messages.zh).length < 70) throw new Error("a short dictionary reached the locale service");
    if (!fake.localeEvents.includes("locale/change")) throw new Error("the plugin does not follow locale changes");
    // The active language came from the service, not from the browser.
    if (langStore.getSnapshot().lang !== "en") throw new Error("the language was not taken from locale.getLocale()");
    // getSnapshot identity is a useSyncExternalStore contract.
    if (langStore.getSnapshot() !== langStore.getSnapshot()) throw new Error("getSnapshot must be stable between changes");
    // Node: the injector mounted without a DOM, and every disposer is callable.
    for (const dispose of fake.effects) {
      if (typeof dispose !== "function") throw new Error("an effect returned no disposer");
      dispose();
    }
  });

  check("plugin: apply survives a host without slots and without locale", () => {
    const bare = { get: () => undefined, effect: () => () => {}, on: () => () => {} };
    plugin.apply(bare);
    const slotted = makeFakeContext();
    slotted.ctx.get = (name) => (name === "slots" ? slotted.slots : undefined);
    plugin.apply(slotted.ctx);
    const names = slotted.registered.map((entry) => entry.name);
    if (!names.includes("settings.section")) throw new Error("the panel must still mount without the locale service");
  });

  check("dialog: one container on document.body, with the modal roles", () => {
    const doc = makeFakeDocument();
    globalThis.document = doc;
    try {
      const first = helpers.dialogRoot();
      const second = helpers.dialogRoot();
      if (first === null) throw new Error("no container was created");
      if (first !== second) throw new Error("a second container was created: the dialog would stack");
      if (first.getAttribute("role") !== "dialog") throw new Error("container is not role=dialog");
      if (first.getAttribute("aria-modal") !== "true") throw new Error("container is not aria-modal=true");
      if (first.getAttribute("aria-labelledby") !== helpers.DIALOG_TITLE_ID) throw new Error("container has no accessible name reference");
      if (doc.body.children.length !== 1) throw new Error("expected exactly one child of body, got " + doc.body.children.length);
      // The container is a direct child of body: nothing above it can trap it in
      // a stacking context.
      if (doc.body.children[0] !== first) throw new Error("the container is not appended to body");
    } finally {
      delete globalThis.document;
    }
  });

  check("i18n: every table key is used, and every used key exists", () => {
    const source = readFileSync(clientPath, "utf8");
    const start = source.indexOf("const MESSAGES = {");
    const end = source.indexOf("/** Which table a language tag resolves to.", start);
    if (start < 0 || end < 0) throw new Error("cannot locate the message tables");
    const body = source.slice(0, start) + source.slice(end);
    const used = new Set();
    // Keys are read at their call sites: t("key") and translate(lang, "key").
    // Scanning every string literal would also catch slot names and CSS values.
    for (const match of body.matchAll(/(?<![A-Za-z0-9_.$])t\(\s*"([^"]+)"/g)) used.add(match[1]);
    for (const match of body.matchAll(/(?<![A-Za-z0-9_.$])translate\([^;]{0,160}?"([a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9]+)+)"/g)) used.add(match[1]);
    // A computed key still has its family prefix at the call site: drop those.
    for (const key of [...used]) if (key.endsWith(".")) used.delete(key);
    // Two families are built by concatenation in the components.
    for (const code of ["running", "starting", "idle", "blocked", "waiting", "failed", "stopped", "resolved", "unknown"]) used.add("thread." + code);
    for (const status of ["pending", "doing", "blocked", "done"]) used.add("status." + status);
    const missing = [...used].filter((key) => !Object.hasOwn(MESSAGES.en, key) || !Object.hasOwn(MESSAGES.zh, key));
    if (missing.length > 0) throw new Error("used but missing from a table: " + missing.join(", "));
    const unused = Object.keys(MESSAGES.en).filter((key) => !used.has(key));
    if (unused.length > 0) throw new Error("in the tables but never shown: " + unused.join(", "));
  });

  check("locale: a switch re-renders from the locale service, not from <html lang>", () => {
    const fake = makeFakeContext();
    let active = "en";
    let onChange = null;
    fake.locale.getLocale = () => ({ active, locales: ["en", "zh"], revision: 1 });
    fake.ctx.on = (event, handler) => {
      if (event === "locale/change") onChange = handler;
      return () => {};
    };
    plugin.apply(fake.ctx);
    if (langStore.getSnapshot().lang !== "en") throw new Error("the initial language did not come from the service");
    const section = fake.registered.find((entry) => entry.name === "settings.section");
    if (section.spec.label() !== "Project folders") throw new Error("en label: " + section.spec.label());
    if (typeof onChange !== "function") throw new Error("no locale/change subscription was made");
    // The service switches; the store and every thunk must follow without a reload.
    active = "zh";
    onChange({ active: "zh" });
    if (langStore.getSnapshot().lang !== "zh") throw new Error("the language did not follow the service");
    if (section.spec.label() !== "项目文件夹") throw new Error("the nav label did not follow: " + section.spec.label());
    if (translate(langStore.getSnapshot().lang, "dialog.saved") !== "已保存") throw new Error("the dialog copy did not follow");
    // Leave the store in English for the checks that run after this one.
    active = "en";
    onChange({ active: "en" });
  });

  check("dialog: all three entries drive the one store the overlay renders", () => {
    const source = readFileSync(clientPath, "utf8");
    // Board card, settings project row, settings workspace row, injected button.
    const openers = source.match(/dialogStore\.show(?:Project|Workspace)\(/g) || [];
    if (openers.length < 4) throw new Error("expected at least 4 entry points into the dialog store, found " + openers.length);
    // And exactly one component is registered into the shell overlay seat.
    const seat = source.match(/name: "shell\.overlay"[^}]*\}, (\w+)\)/);
    if (seat === null) throw new Error("nothing registered into shell.overlay");
    if (seat[1] !== "Overlay") throw new Error("the overlay seat renders " + seat[1] + " instead of Overlay");
    if (!/function Overlay\(\) \{[^}]*h\(FolderDialog\)/.test(source)) throw new Error("Overlay does not render FolderDialog");
  });

  check("panel: one overlay at a time, and a failed write puts the value back", async () => {
    panelStore.show({ bottom: 40, right: 300 }, "manage");
    if (panelStore.getSnapshot().open !== true) throw new Error("the popover did not open");
    if (panelStore.getSnapshot().view !== "manage") throw new Error("the requested view was ignored");
    panelStore.setView("settings");
    if (panelStore.getSnapshot().view !== "settings") throw new Error("the view did not switch back");
    // Opening the folder dialog closes the popover: they share one container.
    dialogStore.showProject({ id: "p9", title: "P9" });
    if (panelStore.getSnapshot().open) throw new Error("the folder dialog left the popover open");
    // ...and opening the popover closes the folder dialog.
    panelStore.show(null);
    if (dialogStore.getSnapshot().open) throw new Error("the popover left the folder dialog open");
    if (panelStore.getSnapshot().anchor !== null) throw new Error("an anchorless open kept a stale anchor");
    panelStore.toggle(null);
    if (panelStore.getSnapshot().open) throw new Error("toggle did not close the open popover");
    panelStore.hide();
    if (panelStore.getSnapshot().open) throw new Error("hide did not close the popover");

    // A write with no host behind it must revert the optimistic value, not stick.
    const before = settingsStore.getSnapshot().sort;
    let failed = false;
    await settingsStore.patch({ sort: "title" }).then(
      () => {},
      () => {
        failed = true;
      }
    );
    if (!failed) throw new Error("a write without a host was reported as saved");
    if (settingsStore.getSnapshot().sort !== before) throw new Error("a failed write kept the optimistic value");
    if (settingsStore.getSnapshot().saving !== false) throw new Error("saving stayed on after a failure");
    if (typeof settingsStore.getSnapshot().error !== "string") throw new Error("the failure was not recorded for the row");
  });

  check("dialog store: one dialog, one subject, and a stable snapshot", () => {
    if (emptyBoard().projects.length !== 0 || emptyBoard().workspaces.length !== 0) throw new Error("emptyBoard must start empty");
    if (emptyBoard().sandbox.available !== false) throw new Error("an empty board pretends the sandbox exists");
    let notifications = 0;
    const off = dialogStore.subscribe(() => { notifications += 1; });
    dialogStore.showProject({ id: "p1", title: "P" });
    const open = dialogStore.getSnapshot();
    if (!open.open || open.kind !== "project" || open.project.id !== "p1") throw new Error("showProject did not open the project dialog");
    if (notifications !== 1) throw new Error("the dialog did not notify its subscribers");
    dialogStore.showWorkspace({ id: "w1", title: "W" });
    const next = dialogStore.getSnapshot();
    if (next.project !== null || next.workspace.id !== "w1") throw new Error("showWorkspace replaced the subject wrongly");
    dialogStore.hide();
    if (dialogStore.getSnapshot().open) throw new Error("hide did not close the dialog");
    const settled = dialogStore.getSnapshot();
    dialogStore.hide();
    if (dialogStore.getSnapshot() !== settled) throw new Error("hiding a closed dialog must not churn the snapshot");
    off();
  });
}
