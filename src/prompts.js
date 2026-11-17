import { fit } from "./kb.js";

export const KB_SECTION = "project-hub/knowledge";
export const BOARD_CONTEXT = "project-hub/board";
export const DIGEST_CONTEXT = "project-hub/digest";

export const SECTION_ORDER = 2851;
export const CONTEXT_ORDER = 231;
export const DIGEST_ORDER = 232;

export function kbSectionText(kbIndex, roleKind) {
  if (kbIndex.length === 0) return "";
  return (roleKind === "thread" ? "本项目共享的短约定（所有会话可见）。" : "本项目短约定（所有讨论串也可见）。") + "\n" + kbIndex;
}

export function boardSectionText(boardContext, roleKind) {
  if (boardContext.length === 0) return "";
  const prefix = roleKind === "thread"
    ? "看板由主对话维护；你完成或受阻时用 board_update 更新对应任务，再用 hub_note 留一句进展。"
    : "看板是项目级视图：讨论串状态自动同步，你只维护手动任务。";
  return prefix + "\n" + boardContext;
}

export function digestSectionText(digestContext, roleKind) {
  if (digestContext.length === 0) return "";
  return roleKind === "thread"
    ? "下面是本项目其它会话最近的进展，避免重复劳动。" + "\n" + digestContext
    : digestContext;
}

export function ensureBudget(text, maxChars) {
  return text.length === 0 ? "" : fit(text, maxChars);
}
