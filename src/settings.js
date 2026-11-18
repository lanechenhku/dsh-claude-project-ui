import { nowIso } from "./util.js";

/**
 * Preferences for this plugin, stored in this plugin's own data directory.
 *
 * They describe the *panel*, not a project: which language to show, whether
 * resolved threads appear, how the cards open, how the list sorts. They also
 * drive two host behaviours that already existed as config defaults
 * (hiding resolved threads in the injected board, and rolling thread reports
 * into tasks), so the panel toggle has to reach the host half.
 *
 * Location: `<dataDir>/settings.json`. Never dsh-threads' storage — that file is
 * theirs, and a preference of ours has no business there.
 */
const FILE = "settings";

/** Every field the file may hold, with the value used when it is absent. */
export const SETTINGS_DEFAULTS = {
  /** "auto" follows the DSH locale service; "zh" / "en" override it. */
  language: "auto",
  /** Resolved and archived threads are hidden by default. */
  showResolvedThreads: false,
  /** Thread reports become board tasks automatically. */
  autoConvergeReports: true,
  /** Other projects' cards start expanded. */
  otherCardsExpanded: false,
  /** "activity" (newest first) or "title". */
  sort: "activity"
};

const LANGUAGES = new Set(["auto", "zh", "en"]);
const SORTS = new Set(["activity", "title"]);

function bool(value, fallback) {
  if (value === true || value === false) return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

function pick(value, allowed, fallback) {
  const text = String(value ?? "");
  return allowed.has(text) ? text : fallback;
}

function withDefaults(defaults) {
  const base = { ...SETTINGS_DEFAULTS };
  if (defaults !== null && typeof defaults === "object") {
    for (const [key, value] of Object.entries(defaults)) {
      if (Object.hasOwn(base, key) && value !== undefined && value !== null) base[key] = value;
    }
  }
  return base;
}

/**
 * Coerce a stored or patched object into the exact settings shape.
 *
 * Unknown keys are dropped and out-of-range values fall back to the effective
 * default, so a hand-edited file (or a stale client) cannot put the panel into
 * a state it has no control for.
 */
export function normalizeSettings(raw, defaults) {
  const base = withDefaults(defaults);
  const value = raw !== null && typeof raw === "object" ? raw : {};
  return {
    language: pick(value.language, LANGUAGES, base.language),
    showResolvedThreads: bool(value.showResolvedThreads, base.showResolvedThreads),
    autoConvergeReports: bool(value.autoConvergeReports, base.autoConvergeReports),
    otherCardsExpanded: bool(value.otherCardsExpanded, base.otherCardsExpanded),
    sort: pick(value.sort, SORTS, base.sort)
  };
}

/** Which stored file the settings live in, for tests and diagnostics. */
export function settingsFile(store) {
  return store.globalFile(FILE);
}

export async function loadSettings(store, defaults) {
  const raw = await store.readGlobal(FILE, {});
  return normalizeSettings(raw, defaults);
}

/** Synchronous read, for priming a session before its first step. */
export function loadSettingsSync(store, defaults) {
  return normalizeSettings(store.readGlobalSync(FILE, {}), defaults);
}

// One read-modify-write at a time: two quick toggles must not lose each other.
let chain = Promise.resolve();

function serialized(task) {
  const run = chain.then(task, task);
  chain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

/**
 * Merge a patch into the stored settings and write atomically.
 * @returns the normalised settings that are now on disk.
 */
export function saveSettings(store, patch, defaults) {
  return serialized(async () => {
    const current = await loadSettings(store, defaults);
    const next = normalizeSettings({ ...current, ...(patch !== null && typeof patch === "object" ? patch : {}) }, defaults);
    await store.writeGlobal(FILE, { ...next, updatedAt: nowIso() });
    return next;
  });
}
