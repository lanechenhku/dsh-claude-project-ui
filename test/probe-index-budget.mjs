
import { kbIndexText } from "../src/kb.js";
const docs = Array.from({ length: 10 }, (_, i) => ({
  id: "k-" + (i + 1),
  title: "约定 " + (i + 1) + "：发布口径与回滚步骤",
  text: "这是第 " + (i + 1) + " 条项目约定的正文，长度大约五六十个字，用来模拟真实文档的摘要长度。",
  tags: [],
  updatedAt: "2026-11-18T00:00:0" + (i % 10) + ".000Z"
}));
const kb = { docs, nextId: 11 };
const oldIndex = "## 项目知识库（" + docs.length + " 篇，用 kb_search 检索、kb_get 读全文）\n" + docs
  .map((d) => "- [" + d.id + "] " + d.title + "（" + d.text.length + " 字） — " + d.text.slice(0, 60))
  .join("\n");
const newIndex = kbIndexText(kb, 280, 3);
console.log("old chars:", oldIndex.length);
console.log("new chars:", newIndex.length);
console.log("saved per request:", oldIndex.length - newIndex.length, "chars");
console.log("---- new index ----");
console.log(newIndex);
process.exit(0);
