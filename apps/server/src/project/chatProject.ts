import type * as Path from "effect/Path";

/** Folder under the server's base dir that holds one folder per chat thread. */
export const CHAT_FOLDER_NAME = "chats";

export const CHAT_PROJECT_TITLE = "Chats";

/** Written into an imported chat's folder; Claude reads it back on resume. */
export const CHAT_HISTORY_FILE = ".claude-chat-history.md";

type PathOps = Pick<Path.Path, "resolve" | "sep">;

export function chatRootFor(path: PathOps, baseDir: string): string {
  return path.resolve(baseDir, CHAT_FOLDER_NAME);
}

/**
 * Chat threads run in `<baseDir>/chats` or one of its per-thread folders, so a
 * cwd there marks a conversational thread rather than a coding one.
 */
export function isChatWorkspacePath(
  path: PathOps,
  baseDir: string,
  cwd: string | null | undefined,
): boolean {
  if (cwd == null || cwd.length === 0) return false;
  const root = chatRootFor(path, baseDir);
  const resolved = path.resolve(cwd);
  return resolved === root || resolved.startsWith(`${root}${path.sep}`);
}
