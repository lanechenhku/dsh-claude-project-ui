import { readFile } from "node:fs/promises";
import { boardView, boardText, addTask, updateTask, loadBoard } from "./board.js";
import { folderForPath, loadFolders } from "./folders.js";
import { addNote, briefText, digestText, eventsOf, loadNotes } from "./digest.js";
import { addDoc, getDoc, kbIndexText, loadKb, removeDoc, searchKb } from "./kb.js";
import { oneLine, truncate } from "./util.js";

const textOutput = {
  schema: { type: "string" },
  render: (_args, value) => [{ type: "text", text: String(value) }]
};

function describe(parameters) {
  return parameters;
}

/**
 * One tool family for every session that belongs to a project. dsh-threads owns
 * projects and threads; this plugin only adds the project-wide memory on top.
 */
export function createTools(runtime, sessionId, defineTool) {
  const { config, store, registry } = runtime;

  const scoped = async () => {
    const role = await registry.roleOf(sessionId);
    if (role.project === null) {
      throw new Error("当前会话不属于任何 dsh-threads 项目：知识库、看板和上下文只在项目的主对话或讨论串里可用。");
    }
    return role;
  };

  const roleLabel = (role) => (role.kind === "thread" ? `讨论串 #${role.thread?.n ?? "?"}` : "项目主对话");

  return [
    defineTool({
      name: "kb_add",
      description:
        "Add one document to the project knowledge base (or replace the document with the same title). Give text inline, or a path to read from disk. Every project session, including threads, can search it.",
      parameters: describe({
        title: { type: "string", required: true, description: "Document title; adding the same title replaces that document." },
        text: { type: "string", description: "Document body. Omit when path is given." },
        path: { type: "string", description: "Absolute path of a UTF-8 text/markdown file to read (max 400k characters)." },
        tags: { type: "array", items: { type: "string" }, description: "Optional tags, at most 8." },
        source: { type: "string", description: "Optional provenance note." }
      }),
      output: textOutput,
      async execute(args) {
        const role = await scoped();
        let text = typeof args.text === "string" ? args.text : "";
        let source = typeof args.source === "string" ? args.source : null;
        if (text.trim().length === 0 && typeof args.path === "string" && args.path.trim().length > 0) {
          const path = args.path.trim();
          // This tool reads with the plugin's own rights, outside the file sandbox,
          // so it enforces the project boundary itself: the main folder and the
          // folders the user mounted, and nothing else.
          const folders = await loadFolders(store, role.project.id);
          const root = folderForPath(path, role.project.folder, folders.folders);
          if (root === null) {
            throw new Error(
              `路径不在项目主文件夹或已挂载的辅助文件夹里：${path}\n` +
                `主文件夹：${role.project.folder.length > 0 ? role.project.folder : "（未知）"}\n` +
                `已挂载：${folders.folders.length > 0 ? folders.folders.join("、") : "（无；在「▤ 项目看板」页签或 /hub folders add <路径> 里添加）"}`
            );
          }
          let raw;
          try {
            raw = await readFile(path, "utf8");
          } catch (error) {
            throw new Error(`读不到 ${path}：${String(error)}`);
          }
          text = raw;
          source = source ?? path;
        }
        const result = await addDoc(store, role.project.id, config, {
          title: args.title,
          text,
          tags: args.tags,
          source
        });
        return [
          `${result.replaced ? "已更新" : "已加入"}知识库 [${result.doc.id}] ${result.doc.title}（${result.doc.text.length} 字）`,
          `项目：${role.project.title} · ${roleLabel(role)}`
        ].join("\n");
      }
    }),

    defineTool({
      name: "kb_list",
      description: "List the project knowledge base: ids, titles, sizes and tags.",
      parameters: describe({
        tag: { type: "string", description: "Only documents carrying this tag." },
        limit: { type: "integer", description: "Rows, default 50, max 200." }
      }),
      output: textOutput,
      async execute(args) {
        const role = await scoped();
        const kb = await loadKb(store, role.project.id);
        const tag = typeof args.tag === "string" ? args.tag.trim() : "";
        const limit = clamp(args.limit, 50, 1, 200);
        const docs = kb.docs.filter((doc) => tag.length === 0 || (doc.tags ?? []).includes(tag)).slice(0, limit);
        if (docs.length === 0) return "知识库还是空的：用 kb_add 加文档。";
        const lines = [`${role.project.title} · 知识库 ${kb.docs.length} 篇`];
        for (const doc of docs) {
          const tags = doc.tags?.length ? " #" + doc.tags.join(" #") : "";
          lines.push(`- [${doc.id}] ${truncate(doc.title, 80)} · ${doc.text.length} 字${tags} · ${oneLine(doc.text, 50)}`);
        }
        return lines.join("\n");
      }
    }),

    defineTool({
      name: "kb_search",
      description: "Search the project knowledge base and get matching snippets with document ids.",
      parameters: describe({
        query: { type: "string", required: true, description: "Keywords; CJK bigrams and latin words both work." },
        limit: { type: "integer", description: "Hits, default 5, max 20." }
      }),
      output: textOutput,
      async execute(args) {
        const role = await scoped();
        const kb = await loadKb(store, role.project.id);
        const hits = searchKb(kb, args.query, clamp(args.limit, 5, 1, 20));
        if (hits.length === 0) return `没有命中「${oneLine(args.query, 60)}」。先用 kb_list 看有哪些文档。`;
        const lines = [`命中 ${hits.length} 篇（项目：${role.project.title}）`];
        for (const hit of hits) {
          lines.push(`\n[${hit.id}] ${hit.title}  score=${hit.score}`);
          lines.push(hit.snippet);
        }
        lines.push("\n用 kb_get 读全文。");
        return lines.join("\n");
      }
    }),

    defineTool({
      name: "kb_get",
      description: "Read one knowledge document by id, optionally a character range.",
      parameters: describe({
        doc_id: { type: "string", required: true, description: "Document id such as k-3." },
        offset: { type: "integer", description: "Start character, default 0." },
        limit: { type: "integer", description: "Characters to return, default 12000, max 40000." }
      }),
      output: textOutput,
      async execute(args) {
        const role = await scoped();
        const kb = await loadKb(store, role.project.id);
        const doc = getDoc(kb, args.doc_id);
        if (doc === null) throw new Error(`没有文档 ${args.doc_id}`);
        const offset = clamp(args.offset, 0, 0, doc.text.length);
        const limit = clamp(args.limit, 12000, 1, 40000);
        const slice = doc.text.slice(offset, offset + limit);
        const more = offset + slice.length < doc.text.length;
        const header = `[${doc.id}] ${doc.title}${doc.tags?.length ? "  #" + doc.tags.join(" #") : ""}  ${offset}-${offset + slice.length}/${doc.text.length} 字`;
        return header + "\n\n" + slice + (more ? `\n\n（还有 ${doc.text.length - offset - slice.length} 字，用 offset 继续读）` : "");
      }
    }),

    defineTool({
      name: "kb_remove",
      description: "Remove one document from the project knowledge base.",
      parameters: describe({ doc_id: { type: "string", required: true, description: "Document id such as k-3." } }),
      output: textOutput,
      async execute(args) {
        const role = await scoped();
        const removed = await removeDoc(store, role.project.id, args.doc_id);
        if (removed === null) throw new Error(`没有文档 ${args.doc_id}`);
        return `已移除 [${removed.id}] ${removed.title}`;
      }
    }),

    defineTool({
      name: "board_add",
      description: "Add a project-level task to the board shared by the main conversation and every thread.",
      parameters: describe({
        subject: { type: "string", required: true, description: "Short task title." },
        status: { type: "string", description: "pending | doing | blocked | done. Defaults to pending." },
        owner: { type: "string", description: "Optional owner label, e.g. lead or #2." },
        note: { type: "string", description: "Optional one-line note." }
      }),
      output: textOutput,
      async execute(args) {
        const role = await scoped();
        const task = await addTask(store, role.project.id, args);
        return `已加任务 [${task.id}] ${task.subject} — ${task.status}`;
      }
    }),

    defineTool({
      name: "board_update",
      description: "Update a board task: status, subject, owner or note. Discussion threads should use this to report their own progress.",
      parameters: describe({
        task_id: { type: "string", required: true, description: "Task id such as b-4." },
        status: { type: "string", description: "pending | doing | blocked | done." },
        subject: { type: "string", description: "Replacement title." },
        owner: { type: "string", description: "Owner label; empty string clears it." },
        note: { type: "string", description: "One-line note; empty string clears it." }
      }),
      output: textOutput,
      async execute(args) {
        const role = await scoped();
        const task = await updateTask(store, role.project.id, args);
        return `已更新 [${task.id}] ${task.subject} — ${task.status}${task.owner !== null ? " @" + task.owner : ""}`;
      }
    }),

    defineTool({
      name: "board_list",
      description: "Show the merged board: live thread states from dsh-threads plus the manual tasks this plugin stores.",
      parameters: describe({
        status: { type: "string", description: "Only manual tasks with this status (threads are always shown)." },
        all: { type: "boolean", description: "Include resolved and archived threads (hidden by default)." }
      }),
      output: textOutput,
      async execute(args) {
        const role = await scoped();
        const threads = await registry.threadsOf(role.project.id);
        const board = await loadBoard(store, role.project.id);
        const view = boardView(role.project, threads, board, {
          all: args.all === true || config.hideResolvedThreads === false
        });
        if (typeof args.status === "string" && args.status.trim().length > 0) {
          view.tasks = view.tasks.filter((task) => task.status === args.status.trim());
        }
        return `项目：${role.project.title} · 你在这里是${roleLabel(role)}\n` + boardText(view);
      }
    }),

    defineTool({
      name: "hub_note",
      description: "Record one line of durable project context (a decision, a constraint, what a thread should know) that every project session will see.",
      parameters: describe({ text: { type: "string", required: true, description: "One line, at most 400 characters." } }),
      output: textOutput,
      async execute(args) {
        const role = await scoped();
        const note = await addNote(store, role.project.id, config, args, roleLabel(role));
        return `已记录 [${note.id}]：${note.text}`;
      }
    }),

    defineTool({
      name: "context_brief",
      description:
        "Compose the project brief: goal, instructions, board state, knowledge index and recent progress from every thread. Paste it into thread_open.task as the background section.",
      parameters: describe({}),
      output: textOutput,
      async execute() {
        const role = await scoped();
        return composeBrief(runtime, role.project, role.kind);
      }
    })
  ];
}

export async function composeBrief(runtime, project, roleKind) {
  const { config, store, registry } = runtime;
  const threads = await registry.threadsOf(project.id);
  const [kb, board, digest] = await Promise.all([
    loadKb(store, project.id),
    loadBoard(store, project.id),
    loadNotes(store, project.id)
  ]);
  const view = boardView(project, threads, board, { all: config.hideResolvedThreads === false });
  const events = eventsOf(threads, digest.notes);
  const index = kbIndexText(kb, config.knowledgeIndexMaxChars, config.kbIndexMaxDocs ?? 3);
  return briefText({
    project,
    kbIndex: index,
    view,
    events,
    maxChars: config.briefMaxChars
  });
}

export function clamp(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(number)));
}

export { digestText };
