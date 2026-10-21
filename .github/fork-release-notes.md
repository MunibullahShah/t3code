My build of [T3 Code](https://github.com/pingdotgg/t3code), with these additions on top of the latest upstream:

- **Chat mode, like Claude Desktop.** A sidebar with your chats and Claude Projects, and new chats that are plain conversations with Claude (no coding tools). Switch between Chat and Code mode with the button at the bottom of the sidebar.
- **Import from Claude.** Bring in your claude.ai / Claude Desktop conversations, memory and Projects from Claude's data export (Claude → Settings → Privacy → Export data), then continue any chat.
- **Keep computer awake.** A toggle (moon/coffee icon in the sidebar, or Settings → General) that stops the computer from sleeping so agents keep working. The screen can still turn off.
- **Link a Claude Project to a real folder.** Put a `.claude-linked-folder` file in a Claude Project's folder (`~/.t3/chats/projects/<project>/`) with the full path of a folder on its first line. That project's chats then work in that folder with coding tools, and still remember the project's instructions and the earlier conversation. Delete the file to unlink.
- **Threads sorted by last use, and pinned chats.** The sidebar lists threads by when you last used them, not when they started. Right-click a thread or chat and choose Pin to keep it at the top.
- **Excel and Word previews.** Open a `.xlsx` or `.docx` file in the file viewer to read it as a table (one tab per sheet) or a page. Agents also open Google Sheets, Docs and Slides they work on in the thread's browser, beside the chat.

## Install

1. Download **{{ASSET}}** below, open it, and drag T3 Code into Applications.
2. The first time, **right-click T3 Code → Open**, then confirm. The app isn't signed by Apple, so a normal double-click is blocked once.
3. Install and sign in to at least one agent: [Claude Code](https://claude.com/product/claude-code) (`claude auth login`) and/or [Codex CLI](https://developers.openai.com/codex/cli) (`codex login`).

Requirements: a Mac with Apple Silicon (M1 or later).
