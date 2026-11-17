**English** · [简体中文](./README.zh-CN.md)

# dsh-claude-project-ui

Bring the **Claude Code Projects + Threads experience** to DeepSeek Harness. On top of
[@kyf-eng/dsh-threads](https://github.com/Kyf-eng/dsh-threads), this plugin adds the project UI,
the interaction model and the context logic Claude users expect.

> In one line: dsh-threads provides the "project + thread" skeleton; this plugin adds the four
> things Claude users are used to — **a project brief every thread can see**, **a board you can
> read at a glance**, **an automatic brief when a thread is opened**, and **context that carries
> over between sessions**.

## Relationship to dsh-threads: a complement, not a replacement

| Capability | `@kyf-eng/dsh-threads` | This plugin `dsh-claude-project-ui` |
|---|---|---|
| Project / thread creation and lifecycle | ✅ owned there | Read-only detection, never writes its data |
| Main conversation as lead, opening threads | ✅ prompt + `thread_open` | — |
| Project-level instructions every thread sees | ❌ main conversation only | ✅ short rules injected into the main conversation and every thread |
| Cross-thread board | ❌ | ✅ sidebar panel + `/hub board` + `board_list` tool |
| Brief when opening a thread | hand-written `task` text | ✅ `context_brief` assembles it |
| Thread reports rolled up as tasks | ❌ | ✅ idempotent rollup keyed by `threadId` |
| Startup context for a new thread | — | ✅ project brief + board + other threads' progress |

The two plugins are decoupled through a **read-only storage file**: this plugin never imports
dsh-threads modules and never writes its storage. Uninstalling either leaves the other working; if
dsh-threads changes its storage format, this plugin silently degrades to "no injection" instead of
throwing.

## Features

### Knowledge base

| Tool | Purpose |
|---|---|
| `kb_add` | Add a document (same title = replace); inline body, or a `path` to read from disk |
| `kb_list` | List id, title, size and tags |
| `kb_search` | Mixed Chinese/English retrieval (CJK bigrams + English words); returns snippets and document ids |
| `kb_get` | Read one document by id, paginated (`offset` / `limit`) |
| `kb_remove` | Delete a document |

Limits: 200 documents, 4M characters and 400k characters per document, per project (configurable).

### Board

Thread state is owned by dsh-threads and read-only here:
`#3 write docs — needs decision · dsh-threads/3-ab12cd`. Manual tasks live separately
(`b-<n>`) with statuses pending / doing / blocked / done.

| Tool | Purpose |
|---|---|
| `board_add` / `board_update` | Create or update a manual task (threads can use it to report their own progress) |
| `board_list` | Merged view: live thread state plus manual tasks |
| `hub_note` | Record one line of project context (a decision, a constraint) visible to every session |

### Context

| Entry point | Purpose |
|---|---|
| `context_brief` tool / `/hub brief` | Compose the project brief and paste it into `thread_open.task` |
| Automatic injection | Every project session (main conversation and each thread) receives: the knowledge index, a board snapshot and recent progress from other threads |

### Commands

```
/hub status                  Which project am I in, how much knowledge / how many tasks
/hub board [--all]           The board (resolved/archived threads hidden by default)
/hub task <title>            Add a manual task
/hub done <b-N>              Mark a task done
/hub rm <b-N>                Delete a task
/hub doctor                  Self-check: data dir, thread storage, injection budget
/hub kb [query]              List the knowledge base, or search it
/hub brief                   Project brief
/hub note <text>             Record one line of project context
/hub add <title> | <body>    Add a knowledge document (body optional)
```

You can paste several lines at once: each line starts with `/hub` (or only the first line does),
and they run in order with a per-line report. A trailing `→ note` is treated as a comment.

## Board panel (sidebar)

The browser half adds a "▤ 看板" button to the **left rail footer**. It opens an overlay on the
right:

- Projects grouped, each listing **live threads** (number, title, state, worktree branch)
- **Tasks** (id, title, status, owner), including the automatically rolled-up thread tasks
- Resolved and archived threads are hidden by default, with a "N more" note
- A "Refresh" button; data comes from the host half's `POST /project-hub/board` and is **read-only**

The panel only exists in the Web GUI (`desktop` / `web` profiles). `tui` and headless have no
sidebar and fall back to the `/hub board` command and the `board_list` tool.

## Install

Requires DeepSeek Harness 0.2.1-rc.2 through 0.3.0.

### Desktop app (`desktop` profile)

**Do not** use `dsh plugin --profile desktop ...`: that profile is owned exclusively by the
Electron app, and the CLI refuses unconditionally
(`profile "desktop" is managed exclusively by the Electron application`) whether or not the app is
running.

Two working paths:

1. **Settings → Plugins → Marketplace**, search `dsh-claude-project-ui`, install, restart.
2. **Manual install** (offline, or when handing over a tarball):

```sh
mkdir -p ~/.dsh/profiles/desktop/node_modules/dsh-claude-project-ui
tar xzf dsh-claude-project-ui-0.2.0.tgz -C /tmp/pkg
cp -R /tmp/pkg/package/. ~/.dsh/profiles/desktop/node_modules/dsh-claude-project-ui/
```

Then edit `~/.dsh/profiles/desktop/package.json`: add
`"dsh-claude-project-ui": "^0.2.0"` to `dependencies` and append `"dsh-claude-project-ui"` to
`dsh.profile.bundles`, then quit DSH completely (⌘Q) and start it again.

> Adding the dependency without the `dsh.profile.bundles` entry does not load the plugin — DSH
> only mounts plugins from the bundles layer.

### Other profiles (`web` / `tui` / custom)

Those are started from the CLI, so the plugin manager works normally:

```sh
dsh plugin --profile web add dsh-claude-project-ui
```

### Uninstall

Desktop app: remove it from `dependencies` and `dsh.profile.bundles`, delete
`~/.dsh/profiles/desktop/node_modules/dsh-claude-project-ui`, restart.
Other profiles: `dsh plugin --profile web remove dsh-claude-project-ui`.

Data stays in `~/.dsh/project-hub/`; uninstalling does not delete it.

## Configuration

Override in the profile's `cordis.patch.yml`:

```yaml
- id: dsh-claude-project-ui
  name: "dsh-claude-project-ui"
  config:
    dataDir: ""                      # default ~/.dsh/project-hub
    threadsStorage: ""               # default ~/.dsh/storages/dsh_threads.json
    knowledgeIndexMaxChars: 280
    kbIndexMaxDocs: 3
    boardContextMaxChars: 700
    digestContextMaxChars: 700
    briefMaxChars: 4000
    maxNotes: 200
    maxDocs: 200
    maxKnowledgeChars: 4000000
    hideResolvedThreads: true        # hide resolved/archived threads in the board and injection
    autoConvergeReports: true        # roll thread reports up into board tasks (idempotent)
```

## Data

```
~/.dsh/project-hub/projects/<projectId>/
  knowledge.json   knowledge documents
  board.json       manual tasks
  notes.json       project context notes
```

Plain JSON, written atomically (temp file + rename); safe to back up or edit by hand.

## Known limitations

- Project detection reads dsh-threads' storage file. If that format changes, detection breaks and
  the plugin silently degrades to "no injection" rather than erroring.
- Retrieval is **lexical** (CJK bigrams + English words + term-frequency normalisation): no vector
  search and no LLM summarisation, so write clear titles and keywords.
- Summaries are not model-generated: the automatic part comes from dsh-threads' `lastReport`, the
  manual part from `hub_note`. Nothing the main conversation never reported will show up.
- Injection is truncated by characters (700–900 per section by default), not by tokens.
- The panel is read-only: creating, changing or deleting tasks today means `board_add` /
  `board_update` / `/hub task|done|rm`.
- Refreshes are polled: every 10 seconds plus on agent status changes, so a snapshot can be up to
  10 seconds stale.
- The board hides resolved/archived threads by default; use `board_list all=true` or
  `/hub board --all` to see everything.

## Verification record (2026-11-18, local desktop profile)

| Layer | Result | Evidence |
|---|---|---|
| Commands | Pass | Session log `command/run` + `command/done`; a 5-line paste and `add \| body` both worked; `knowledge.json` written |
| Tools | Pass | In the project's main conversation the model called `tools.kb_search({query:"release"})` through PTC; returned `[k-1] release checklist score=0.343` |
| Injection (knowledge) | Pass | Real system prompt contained the shared-knowledge section |
| Injection (board/progress) | Pass | Thread #2's request body (`user/message`, 12.7 KB) contained `## 项目看板`, two thread rows and `## 项目进展` verbatim; knowledge rode in `system/message` (section vs context channels) |
| Schema compatibility | Pass | `node test/spec-check.mjs` validates all 10 tool definitions against the host DSL |
| Logic | Pass | `node test/harness.mjs`, 19 checks (changedFiles, hiding rules, rollup idempotency, `/hub doctor`) |

## Relationship to Team mode

A Team-mode task board belongs to **one session's subagent tree**; this plugin's board belongs to
**one dsh-threads project** (main conversation plus all of its threads). They complement each other
and never write to the same place.
