# This fork (MunibullahShah/t3code)

A personal fork of [pingdotgg/t3code](https://github.com/pingdotgg/t3code) that adds Claude Desktop-style chats, an importer for Claude's data export, and a keep-awake toggle. `AGENTS.md` still applies in full; this file covers only what the fork adds and how to keep it healthy. The developer is the **user** here: one person running their own build, not the T3 maintainers.

## Branches and the one rule

| Branch                      | Purpose                                                                                                    |
| --------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `main`                      | Exact mirror of `pingdotgg/main`. **Never commit here.** Sync fast-forwards it, and a commit breaks that.  |
| `feat/claude-chat-mode`     | Chat mode, the Claude export import, Claude memory and Projects.                                           |
| `feat/keep-awake`           | Keep-awake toggle. Built on `feat/claude-chat-mode`, not `main`.                                           |
| `feat/linked-chat-folders`  | Links a Claude Project to a real folder. Built on `feat/claude-chat-mode`, not `main`.                     |
| `feat/sidebar-recency-pins` | Sorts threads by last use and adds chat pins. Built on `feat/claude-chat-mode`, not `main`.                |
| `feat/office-previews`      | Excel and Word previews, Google files in the browser panel. Built on `main`.                               |
| `my-t3`                     | Integration branch: merges every feature branch. The fork's default branch. Built, installed and released. |

- **New features:** run `git switch -c feat/<name> main`, then add `"feat/<name>:main"` to `FEATURE_BRANCHES` at the top of `scripts/fork-sync.sh` (on `my-t3`).
- **Fork-wide files** (this file, the multi-branch sync script, the fork's own `README.md`, and the release workflow with its notes) live only on `my-t3`. On a sync conflict in `README.md`, keep the fork's version.
- **Never** push to `upstream` (its push URL is set to `DISABLED`), and don't open pull requests to pingdotgg unless the user asks.
- **Commits:** author `Munib <munibs47@gmail.com>`, which is the email on the user's GitHub account. Keep the `Co-Authored-By: Claude …` trailer; the user chose to keep it.

## Everyday operations

```bash
scripts/fork-sync.sh            # pull upstream into main, each feature branch and my-t3, push all
scripts/fork-sync.sh --install  # same, then build the macOS app from my-t3 and install it
```

- Run the sync from `my-t3`. It copies itself to a temp file first, because switching branches rewrites the script while bash is still reading it.
- **On a conflict** the script stops on the branch it was merging into. Resolve it, then run `git add -A && git commit --no-edit`, then rerun the script. Usual conflict spots are listed under "Merging upstream" below.
- **Building by hand:**
  - The desktop build needs Rust (`brew install rustup`, keg-only at `/opt/homebrew/opt/rustup/bin`) and the repo's `vp` on `PATH`: `export PATH="$PWD/node_modules/.bin:/opt/homebrew/opt/rustup/bin:$PATH"`.
  - Then run `node scripts/build-desktop-artifact.ts --platform mac --target dmg --arch arm64 --output-dir release`.
  - The build is unsigned, so `xattr -dr com.apple.quarantine` it after copying into `/Applications`.
- **Releases:**
  - Automatic: `.github/workflows/fork-release.yml` runs on every push to `my-t3` (feature merges and syncs) that changes more than Markdown or `docs/`. It builds the unsigned arm64 DMG on a `macos-15` runner and publishes `my-t3-YYYY.MM.DD`, adding `.1`, `.2` … when that day's tag exists. Release notes come from `.github/fork-release-notes.md`; update it when a feature is added. Run it by hand from the Actions tab (`workflow_dispatch`).
  - By hand: `gh release create my-t3-YYYY.MM.DD <dmg> --target my-t3 --repo MunibullahShah/t3code`.
  - **Never tag `v*`.** Upstream's `release.yml` fires on `v*.*.*` tags.
  - Check runs with `gh run list --repo MunibullahShah/t3code --workflow fork-release.yml`.
- **Plugin quirk:** an `everything-claude-code` hook blocks any shell command that contains `git commit` plus a `-n` flag anywhere (for example `bash -n`, `grep -n`). Run commits in their own command.

## Feature 1: Chat mode (Claude Desktop-style chats)

**Model.** A chat is an ordinary thread whose working folder is under `<T3 home>/chats` (`~/.t3/chats`). That location alone makes it chat-only; there's no new thread type.

**Server, a Chats system project, built the way upstream builds Scratch ("No project"):**

- `apps/server/src/project/chatProject.ts`
  - Path helpers: `chatRootFor`, `isChatWorkspacePath`.
  - Context file names: `.claude-chat-history.md` per chat, `.claude-memory.md` at the chats root, `.claude-project.md` at a Claude Project root.
- `ManagedProjectFolders.ts`
  - `chatRoot` and `ensureChatProject` ("Chats", defaults to the `claudeAgent` model).
  - `ensureChatSubProject` creates imported Claude Projects under `chats/projects/<slug>-<id8>`.
  - `folderForThread` gives every chat in the Chats project its own folder, as it does for Scratch.
- **RPC:** `projects.ensureScratch` takes an optional `kind: "chat"` (`ProjectEnsureScratchInput`). Server config reports `chatWorkspaceRoot`.
- **`RuntimePolicy.ts`:** a cwd under the chats root sets `chatOnly: true` and `chatRoot` on `ProviderAdapterV2RuntimePolicy`. ServerConfig and Path are optional services, so policy tests keep working without them.
- **`ClaudeAdapterV2.ts`:** when the runtime policy has `chatOnly`:
  - It uses `CLAUDE_CHAT_QUERY_POLICY`: no tools, no permission callback, no bypass.
  - It attaches no T3 MCP server.
  - The system prompt is `claudeChatSystemPrompt(context)`: a plain assistant prompt plus `<user_memory>`, `<project>` and `<earlier_conversation>` sections. They're read from the context files, with the project file looked up in the cwd or its parent, and each section capped in size.
  - `chatOnly` is part of the live-query policy key, so a chat and a coding thread never reuse one Claude process.
- **Other adapters:** they ignore `chatOnly`. Chats are a Claude feature.

**Web:**

- **Setting:** `appMode: "code" | "chat"` in `ClientSettings`.
- **Chat-mode sidebar:**
  - `AppSidebarLayout` renders `sidebar/ChatSidebar.tsx` in chat mode.
  - The layout logic lives in `chatSidebar.logic.ts`: New, then each Claude Project with its 4 latest chats and View all, then loose chats, newest first.
  - It uses the `strong` variant added to `SidebarMenuButton`, because UI components can't be restyled with `className`.
- **Code mode:** the original sidebar, plus the chat-mode branches added to `Sidebar.tsx` (scope picker limited to chat projects, settled chats folded into one list, `sortChatsByRecency`).
- **Entry points:**
  - Settings → General → Chats (`ChatsSettings.tsx`: mode, import).
  - Sidebar footer (`SidebarChrome.tsx`: mode switch, new chat).
  - Command palette.
  - Keybinding `chat.newClaudeChat` (`mod+alt+c`).
  - `/` opens a new chat in chat mode (`_chat.index.tsx`). `mod+n` starts a chat (`_chat.tsx`).
- **Shared logic:** `useScratchProject` (`startChatThread`, `chatEnvironmentId`). `client-runtime`'s `isChatProject` and `chatProjectScopeKeys` match any project under the chats root.

## Feature 2: Import from Claude's data export

**Server code (`apps/server/src/chats/`):**

- `claudeExportSource.ts`: finds the export in a folder, zip or `conversations.json`. It also reads `memories/*.json`, `projects/*.json` and the optional `t3-project-assignments.json`.
- `claudeExportParser.ts`: lenient, schema-based parsing of `conversations.json`. It keeps only `text` content blocks and notes attachments by name.
- `claudeExportExtras.ts`: memory and Projects. Anthropic's starter projects are skipped.
- `ClaudeExportImporter.ts`: a service behind the RPC `chats.importClaudeExport`, contract in `packages/contracts/src/claudeExport.ts`.

**What the importer does:**

- Writes events directly: `thread.created` plus `messageEvents`, the latter exported from `AgentSessionImporter`.
- Uses `historyOrigin: "v1_import"`, with no provider thread and no settled state.
- **Chat history:**
  - Each chat gets a folder holding `.claude-chat-history.md`.
  - The thread view is capped at the last 1000 messages.
  - Claude gets about the last 120k characters of history when the chat continues.
- **Thread IDs:** `import:claude-ai:<uuid>` for loose chats, `import:claude-ai:<uuid>:project` for chats in a project. Importing again is idempotent.

**Project membership.** Claude's export doesn't say which project a chat belongs to. `t3-project-assignments.json` (`{conversationUuid: projectUuid}`, written next to the export) puts assigned chats in their project's folder. A copy already imported into Chats is deleted (`thread.delete`) and recreated in the project **only if** its message count still equals the imported count. A chat the user has continued in T3 stays put. The user's own mapping was built from screenshots of Claude Desktop and lives at `~/Claude/Imports/t3-project-assignments.json`.

**Web.** Settings → General → Chats lets you type a path or Browse (desktop folder picker). There's also the welcome wizard's import step (`ClaudeChatsImportCallout.tsx`) and the command palette. Every failure shows a toast. A silent picker failure once made the import look like it did nothing. The hook is `useClaudeExportImport`.

## Feature 2b: Linked Claude Project folders

- **What:** a `.claude-linked-folder` file at a Claude Project's root (`chats/projects/<slug>-<id8>`) holds an absolute folder on its first non-blank line. That project's chats then run in that folder as coding threads with tools, instead of tool-less chats.
- **Server:** `RuntimePolicy.ts` looks for the file in the chat's folder, then its parent, never at the chats root. A valid link sets `cwd` to the linked folder and `chatContextDir` to the chat's own folder, and drops `chatOnly`. A relative path or a missing folder logs a warning and keeps the chat tool-less.
- **Claude:** `ClaudeAdapterV2.ts` reads memory, project and history from `chatContextDir` and appends them to the Claude Code prompt (`claudeLinkedChatPrompt`). Claude Code resumes a session by ID from any cwd, so chats already continued in T3 keep their memory.
- **Link or unlink:** write or delete the file. A live Claude process keeps its old folder until it restarts.
- **The user's links:** Docwise → `~/Documents/Ambeego/Docwise`, Everflow Snowflake → `~/Documents/projects/everflow-snowflake`, message replier extension → `~/Documents/projects/message replier`. The other Claude Projects stay chat-only by choice.
- **Not yet:** no UI to set a link, and the diff and checkpoint panels may still follow the project's chat folder (unchecked).

## Feature 2c: Threads sorted by last use, pinned chats

- **Code mode:** `partitionSidebarThreads` (`Sidebar.tsx`) lists active threads with `sortThreadsByLastUse` (the user's latest message, else latest activity) instead of upstream's creation/inbox order. Upstream tracks this as pingdotgg/t3code#16412. Dragging within the active list does nothing (`activeTimeOrdered: true`); pinning holds a spot, and pinned threads stay draggable.
- **Chat mode:** right-click a chat for Pin/Unpin (`openChatMenu` in `ChatSidebar.tsx`, one handler for all rows). `buildChatSidebarModel` returns `pinned` chats in pin order and removes them from their project and loose lists.
- **Merging upstream:** `Sidebar.tsx` is the hotspot. Keep upstream's change, then re-apply the single `sortThreadsByLastUse(active)` sort and `activeTimeOrdered: true` at both `planSidebarThreadDrop` call sites.

## Feature 2d: Excel and Word previews, Google files beside the chat

- **Previews:** `WorkspaceOfficePreview.tsx` renders `.xlsx` as a table with a tab per sheet (`read-excel-file`) and `.docx` as a page in a `sandbox=""` frame whose CSP blocks scripts and network (`mammoth`). Both load lazily. `workspaceOfficePreviewKind` (`@t3tools/shared/filePreview`) picks them; `FilePreviewPanel.tsx` routes them before the text-read error branch.
- **Google files:** `T3_CODE_GOOGLE_FILES_INSTRUCTIONS` (provider-core `orchestrationInstructions.ts`) tells Claude threads with T3's tools to `preview_open` any Google Sheet, Doc or Slides file they work on. Claude only; other providers don't get it.
- **Google connectors need a one-time sign-in in Claude Code:** run `claude`, then `/mcp`, and authenticate each `claude.ai Google …` server. Until then T3 sessions report them as `needs-auth`. Drive was already signed in on 2026-10-21; Sheets, Docs, Slides, Gmail and Calendar were not.
- **Merging upstream:** `ClaudeAdapterV2.ts` `systemPrompt` keeps both fork additions: the chat ternary and the Google files text after `T3_CODE_ORCHESTRATION_INSTRUCTIONS`.

## Feature 3: Keep awake

- **Setting:** `keepAwake` (`ServerSettings`). It lives on the server, so any client (desktop, web, mobile) toggles the machine that's running the agents.
- **Server:**
  - `apps/server/src/power/keepAwakeCommand.ts` picks the tool: `caffeinate -i -w <server pid>` on macOS (it exits if the server dies), `systemd-inhibit --what=idle:sleep … sleep infinity` on Linux, nothing elsewhere.
  - `KeepAwake.ts` follows the setting with `Stream.switchMap`, so the helper lives in a scope and is killed when the setting turns off.
  - It's started as a worker in `server.ts`. `ws.ts` reports `keepAwakeSupported`.
  - It blocks idle sleep only, so the display can still sleep. On a MacBook, closing the lid still sleeps unless it's on power with an external display.
- **Web:** `useKeepAwake` (primary environment's setting) powers the sidebar footer moon/coffee button, Settings → General, and the command palette.

## Merging upstream: known hotspots

These files are shared with upstream and conflict most often. Keep upstream's change and re-apply the fork's addition:

- **`apps/server/src/ws.ts`:** re-add `chatWorkspaceRoot`, `keepAwakeSupported`, the `kind: "chat"` branch of `projectsEnsureScratch`, and the `chatsImportClaudeExport` handler with its `ClaudeExportImporter` service.
- **`ClaudeAdapterV2.ts`:** keep `chatOnly` first in `claudeRuntimeQueryPolicyForRuntimePolicy`. The `systemPrompt` ternary has to keep upstream's `append` contents for coding threads.
- **`ManagedProjectFolders.ts`:** upstream's `isScratchRoot` / `isScratchProject` sit next to the fork's `managedRootForProject`, `chatRoot` and `ensureChatSubProject`.
- **`Sidebar.tsx`:** chat-mode inputs (`chatMode`) are threaded through `useSidebarThreads` and `partitionSidebarThreads`.
- **`ws.test.ts`:** its folder mock needs `chatRoot`, and its layer needs a `ClaudeExportImporter` mock. When upstream adds strict layer typing, check this file.
- **`ClaudeProvider.ts`:** the fork once retried the version probe. Upstream's 20 s `CLAUDE_VERSION_CHECK_TIMEOUT_MS` replaced it.

After a sync, run the type checks listed in the Verifying section of `AGENTS.md` for `apps/server`, `apps/web`, `packages/contracts` and `packages/client-runtime`, then these tests:

```bash
vp test run apps/server/src/chats apps/server/src/power apps/server/src/ws.test.ts apps/server/src/project/ManagedProjectFolders.test.ts packages/client-runtime/src/state/chatProjects.test.ts apps/web/src/components/sidebar/chatSidebar.logic.test.ts
```

Upstream tests that already fail on this machine without fork changes:

- `ClaudeAdapterV2.test.ts`: "moves the root's foreground subagents to the background before a steer" (times out).
- `AgentSessionScanner.test.ts`: the symlink sandbox test, which hits a macOS `/private` path quirk.

## Verifying in the installed app

- **The user's real data** is in `~/.t3`. That includes 182 imported chats and 7 Claude Projects. Read it with `sqlite3 -readonly` only (`orchestration_v2_projection_threads`, `projection_projects`), as `AGENTS.md` requires.
- **Driving the real app:** launch it with `open -a "/Applications/T3 Code (Beta).app" --args --remote-debugging-port=9333` and use the Chrome DevTools Protocol to click or screenshot. **Always relaunch without the port afterwards**, and check it's closed (`curl 127.0.0.1:9333/json/list` should fail).
- **Keep awake:** check it with `pmset -g assertions` (look for `caffeinate asserting on behalf of` the server's PID). Leave it off unless the user wants it on.
