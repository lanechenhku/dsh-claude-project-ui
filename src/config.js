/** Additive defaults; every value is optional in the profile patch. */
export const DEFAULTS = {
  /** Where stored knowledge, tasks and progress notes live. Empty = ~/.dsh/project-hub. */
  dataDir: "",
  /** dsh-threads storage file, read only, to learn which sessions belong to which project. */
  threadsStorage: "",
  /** DSH workspace storage file, written only when switching a project's main folder.
   * Empty = workspace.json next to threadsStorage. */
  workspaceStorage: "",
  /** Cap for the injected knowledge index, in characters. Keep it small: dsh-knowledge owns long-form retrieval. */
  knowledgeIndexMaxChars: 280,
  /** How many documents the injected index lists before it just says "search with kb_search". */
  kbIndexMaxDocs: 3,
  /** Cap for the injected board snapshot, in characters. */
  boardContextMaxChars: 700,
  /** How many auxiliary folders a project may mount on top of its main folder. */
  maxExtraFolders: 8,
  /** Cap for the injected auxiliary-folder list, in characters. */
  foldersContextMaxChars: 600,
  /** Cap for the injected progress digest, in characters. */
  digestContextMaxChars: 700,
  /** Cap of the context_brief tool result, in characters. */
  briefMaxChars: 4000,
  /** How many progress notes are kept per project. */
  maxNotes: 200,
  /** How many knowledge documents a project may hold. */
  maxDocs: 200,
  /** Total characters of knowledge text a project may hold. */
  maxKnowledgeChars: 4000000,
  /** Hide resolved/archived threads from the board and from the injected snapshot. board_list all=true or /hub board --all shows them. */
  hideResolvedThreads: true,
  /** Mirror each thread report onto the board as an auto task (idempotent, keyed by thread id). */
  autoConvergeReports: true
};

export function resolveConfig(config) {
  const user = config !== null && typeof config === "object" ? config : {};
  const out = { ...DEFAULTS };
  for (const [key, fallback] of Object.entries(DEFAULTS)) {
    const value = user[key];
    if (value === undefined || value === null) continue;
    out[key] =
      typeof fallback === "number" ? Math.max(0, Number(value) || 0)
      : typeof fallback === "boolean" ? value === true || value === "true" || value === 1
      : String(value);
  }
  return out;
}
