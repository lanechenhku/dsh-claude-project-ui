import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/** Read a JSON file, returning fallback for anything unreadable. Never throws. */
export async function readJson(file, fallback) {
  try {
    const text = await readFile(file, "utf8");
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

/** Write JSON atomically; a crash cannot leave a half-written file. */
export async function writeJson(file, value) {
  await mkdir(dirname(file), { recursive: true });
  const tmp = file + ".tmp-" + process.pid + "-" + Date.now();
  await writeFile(tmp, JSON.stringify(value, null, 2) + "\n", "utf8");
  await rename(tmp, file);
}

export function truncate(text, max) {
  const value = String(text ?? "");
  if (max <= 0 || value.length <= max) return value;
  return value.slice(0, Math.max(0, max - 1)) + "…";
}

export function oneLine(text, max = 120) {
  return truncate(String(text ?? "").replace(/\s+/g, " ").trim(), max);
}

export function nowIso() {
  return new Date().toISOString();
}

/** Split a text into paragraph-ish chunks for snippets and indexing. */
export function paragraphs(text) {
  return String(text ?? "")
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}
