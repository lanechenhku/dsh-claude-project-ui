import { nowIso, oneLine, truncate } from "./util.js";

const FILE = "knowledge";
const MAX_TEXT = 400000;

export async function loadKb(store, projectId) {
  const raw = await store.read(projectId, FILE, { docs: [], nextId: 1 });
  const docs = Array.isArray(raw.docs) ? raw.docs.filter(isDoc) : [];
  const nextId = Number(raw.nextId) > 0 ? Number(raw.nextId) : docs.length + 1;
  return { docs, nextId };
}

function isDoc(value) {
  return value !== null && typeof value === "object" && typeof value.id === "string" && typeof value.text === "string";
}

export function loadKbSync(store, projectId) {
  const raw = store.readSync(projectId, FILE, { docs: [], nextId: 1 });
  const docs = Array.isArray(raw.docs) ? raw.docs.filter(isDoc) : [];
  const nextId = Number(raw.nextId) > 0 ? Number(raw.nextId) : docs.length + 1;
  return { docs, nextId };
}

export function kbChars(kb) {
  return kb.docs.reduce((sum, doc) => sum + doc.text.length, 0);
}

/** Add or replace one document. Returns the document plus whether it replaced another. */
export async function addDoc(store, projectId, config, input) {
  const kb = await loadKb(store, projectId);
  const title = oneLine(input.title ?? "", 120);
  if (title.length === 0) throw new Error("kb_add 需要 title");
  const text = String(input.text ?? "");
  if (text.trim().length === 0) throw new Error("kb_add 需要 text 或 path 的非空内容");
  if (text.length > MAX_TEXT) throw new Error(`文档超过 ${MAX_TEXT} 字符上限（当前 ${text.length}）`);

  const existing = kb.docs.find((doc) => doc.title === title) ?? null;
  if (existing === null && kb.docs.length >= config.maxDocs) throw new Error(`知识库已有 ${kb.docs.length} 篇，达到上限 ${config.maxDocs}`);
  const total = kbChars(kb) - (existing?.text.length ?? 0) + text.length;
  if (total > config.maxKnowledgeChars) throw new Error(`知识库总字数将达 ${total}，超过上限 ${config.maxKnowledgeChars}`);

  const doc = {
    id: existing?.id ?? "k-" + kb.nextId,
    title,
    text,
    tags: Array.isArray(input.tags) ? input.tags.map((tag) => oneLine(tag, 24)).filter(Boolean).slice(0, 8) : [],
    source: typeof input.source === "string" ? input.source : null,
    addedAt: existing?.addedAt ?? nowIso(),
    updatedAt: nowIso()
  };
  if (existing === null) {
    kb.docs.push(doc);
    kb.nextId += 1;
  } else {
    kb.docs[kb.docs.indexOf(existing)] = doc;
  }
  await store.write(projectId, FILE, kb);
  return { doc, replaced: existing !== null };
}

export async function removeDoc(store, projectId, docId) {
  const kb = await loadKb(store, projectId);
  const index = kb.docs.findIndex((doc) => doc.id === docId);
  if (index === -1) return null;
  const [removed] = kb.docs.splice(index, 1);
  await store.write(projectId, FILE, kb);
  return removed;
}

export function getDoc(kb, docId) {
  return kb.docs.find((doc) => doc.id === docId) ?? null;
}

/** CJK bigrams plus latin words: enough for a dependency-free lexical search. */
export function tokenize(query) {
  const terms = new Set();
  const lower = String(query ?? "").toLowerCase();
  for (const word of lower.match(/[a-z0-9_]+/g) ?? []) {
    if (word.length > 1) terms.add(word);
  }
  for (const run of lower.match(/[\u4e00-\u9fff]+/g) ?? []) {
    if (run.length === 1) {
      terms.add(run);
      continue;
    }
    for (let i = 0; i + 1 < run.length; i += 1) terms.add(run.slice(i, i + 2));
  }
  return [...terms];
}

export function searchKb(kb, query, limit = 5) {
  const terms = tokenize(query);
  if (terms.length === 0) return [];
  const results = [];
  for (const doc of kb.docs) {
    const lowerTitle = doc.title.toLowerCase();
    const lowerText = doc.text.toLowerCase();
    let score = 0;
    let firstHit = -1;
    let hitTerm = "";
    for (const term of terms) {
      let count = 0;
      let index = lowerText.indexOf(term);
      while (index !== -1 && count < 40) {
        count += 1;
        if (firstHit === -1 || index < firstHit) {
          firstHit = index;
          hitTerm = term;
        }
        index = lowerText.indexOf(term, index + term.length);
      }
      if (count > 0) score += term.length * Math.log(1 + count);
      if (lowerTitle.includes(term)) score += 2 + term.length;
    }
    if (score <= 0) continue;
    const length = Math.max(200, lowerText.length);
    results.push({ doc, score: score / Math.sqrt(length), hitIndex: firstHit, hitTerm });
  }
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit).map((entry) => ({
    id: entry.doc.id,
    title: entry.doc.title,
    score: Number(entry.score.toFixed(3)),
    tags: entry.doc.tags ?? [],
    snippet: snippetOf(entry.doc.text, entry.hitIndex, entry.hitTerm)
  }));
}

function snippetOf(text, index, term) {
  if (index < 0) return oneLine(text, 160);
  const start = Math.max(0, index - 80);
  const end = Math.min(text.length, index + Math.max(80, term.length * 6));
  const head = start > 0 ? "…" : "";
  const tail = end < text.length ? "…" : "";
  return head + oneLine(text.slice(start, end), 200) + tail;
}

/**
 * The compact index that every project session receives in its prompt.
 *
 * Long-form retrieval belongs to dsh-knowledge; this layer only carries the short
 * project conventions an agent should see without searching, so the index stays a
 * couple of lines and never competes with the knowledge plugin for context.
 */
export function kbIndexText(kb, maxChars, maxDocs = 3) {
  if (kb.docs.length === 0) return "";
  const ordered = [...kb.docs].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  const shown = ordered.slice(0, Math.max(1, maxDocs));
  const header = `## 项目短约定（${kb.docs.length} 条，kb_search 检索；长文档用 knowledge_search）`;
  const lines = shown.map((doc) => {
    const tags = doc.tags?.length ? " #" + doc.tags.join(" #") : "";
    return `- [${doc.id}] ${truncate(doc.title, 40)}${tags} — ${oneLine(doc.text, 60)}`;
  });
  if (ordered.length > shown.length) lines.push(`- 另有 ${ordered.length - shown.length} 条，用 kb_search 检索`);
  return fit([header, ...lines].join("\n"), maxChars);
}

export function fit(text, maxChars) {
  if (maxChars <= 0 || text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars - 20);
  const lastNewline = cut.lastIndexOf("\n");
  return (lastNewline > maxChars * 0.5 ? cut.slice(0, lastNewline) : cut) + "\n…（已截断）";
}
