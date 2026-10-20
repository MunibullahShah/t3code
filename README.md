# T3 Code (Munib's build)

A personal build of [T3 Code](https://github.com/pingdotgg/t3code), the open-source app for running coding agents (Claude Code, Codex, Cursor and more) from desktop, web and mobile. It adds three things on top:

- **Chat mode.** Plain conversations with Claude, laid out like Claude Desktop. Chats have no tools: Claude can't read files or run commands in them.
- **Import from Claude.** Bring your claude.ai and Claude Desktop conversations, Claude's memory about you, and your Claude Projects into T3, then keep chatting in them.
- **Keep awake.** A toggle that stops the computer from idle-sleeping so agents keep working while you're away. Works on macOS and on Linux with systemd.

## Install

You need [Claude Code](https://claude.com/product/claude-code) installed and signed in (`claude auth login`). Chats run through it.

### Download (Apple Silicon Mac)

1. Download the latest `.dmg` from [Releases](https://github.com/MunibullahShah/t3code/releases/latest).
2. Open it and drag **T3 Code (Beta)** into **Applications**.
3. The app isn't signed, so macOS blocks the first launch. Run this once, then open it normally:

   ```bash
   xattr -dr com.apple.quarantine "/Applications/T3 Code (Beta).app"
   ```

### Build from source (macOS)

You need Node.js 24.13 or newer, pnpm, and Rust (`brew install rustup`).

```bash
git clone https://github.com/MunibullahShah/t3code.git
cd t3code
pnpm install
export PATH="$PWD/node_modules/.bin:/opt/homebrew/opt/rustup/bin:$PATH"
node scripts/build-desktop-artifact.ts --platform mac --target dmg --arch arm64 --output-dir release
```

The `.dmg` lands in `release/`. Install it as above.

## Import your Claude chats

### 1. Export your data from Claude

1. In [claude.ai](https://claude.ai) or the Claude Desktop app, click your name in the bottom-left corner, then **Settings**.
2. Open **Privacy** and click **Export data**.
3. Claude emails you a download link, usually within a few minutes. The link expires after about a day.
4. Download the zip. You don't need to unzip it.

The export holds everything in your account, so keep it private.

### 2. Import it into T3

1. Open **Settings → General → Chats → Import from Claude**. You can also use **Import Claude conversations…** in the command palette (`⌘K`).
2. Click **Browse…** and pick the folder holding the zip (or the folder you unzipped it into). You can also paste the path.
3. Click **Import**.

Each conversation becomes a chat you can continue, and Claude gets the earlier conversation back as context. Your memory is used in every chat, and your Projects appear in the sidebar. Importing the same export again skips chats that are already there.

To see your chats like Claude Desktop does, click **Switch to Chat mode** at the bottom of the sidebar.

### Putting chats back in their projects (optional)

Claude's export doesn't record which project each chat was in, so imported chats start in the general list. To place them, save a file named `t3-project-assignments.json` next to the export, mapping each conversation ID to its project ID (both from the export), then import again:

```json
{
  "<conversation uuid>": "<project uuid>"
}
```

Chats you haven't continued in T3 move into their projects. Chats you've already added messages to stay where they are.
